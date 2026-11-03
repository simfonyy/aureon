use std::{collections::HashSet, time::Duration};

use serde_json::Value;

use super::{map_artist, ClipDto, ClipStreamDto, YArtist, YTrack, Yandex, BASE, MUSIC_CLIENT};

// Metadata: MarshalX/yandex-music-api, _client_async/clips.py and clip/clip.py.
// VH contract: LiquidMusicGlass YandexMusicClient.kt, commit
// 636c8c5ca0d542d5f27c67a26a879c81b3dd1148, resolveClipHls/vhPlayerUrl.

const MAX_IDS: usize = 32;
const MAX_BODY: usize = 2 * 1024 * 1024;
const VH_BASE: &str = "https://frontend.vh.yandex.ru";
const API_USER_AGENT: &str = "Yandex-Music-API";
// VH selects supported streams from the browser family. The API client name
// returns error:"old_browser" and two empty stream objects, even for clear HLS.
const VH_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DRM_ERROR: &str = "Этот клип защищён DRM. Встроенное воспроизведение недоступно.";

fn numeric_id(value: &str) -> Option<String> {
    if value.is_empty()
        || value.len() > 20
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let canonical = value.trim_start_matches('0');
    (!canonical.is_empty()).then(|| canonical.to_owned())
}

fn value_id(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => numeric_id(text),
        Value::Number(number) => number.as_u64().filter(|id| *id > 0).map(|id| id.to_string()),
        _ => None,
    }
}

pub(super) fn clip_ids(values: &[Value]) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .iter()
        .filter_map(value_id)
        .filter(|id| seen.insert(id.clone()))
        .take(MAX_IDS)
        .collect()
}

/// Metadata is returned to the WebView; no server request is made to these URLs.
/// Unknown media domains stay unavailable rather than accepting an arbitrary URL.
fn media_url(raw: Option<&str>, image: bool) -> Option<String> {
    let raw = raw.filter(|text| !text.is_empty() && text.len() <= 8192)?;
    if raw.chars().any(char::is_control) || raw.contains('\\') {
        return None;
    }
    let expanded = if image {
        let replaced = raw.replace("%%", "640x360");
        if replaced.starts_with("https://") {
            replaced
        } else if !replaced.contains("://") && !replaced.starts_with('/') {
            format!("https://{replaced}")
        } else {
            return None;
        }
    } else {
        raw.to_owned()
    };
    let url = reqwest::Url::parse(&expanded).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return None;
    }
    let host = url.host_str()?;
    let allowed = ["yandex.net", "yandex.ru", "yandex.com", "yandexcdn.net"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")));
    allowed.then(|| url.to_string())
}

fn text(value: Option<&Value>, limit: usize) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(limit)
        .collect()
}

fn parse_clips(result: &Value, requested: &[String]) -> Result<Vec<ClipDto>, String> {
    let rows = result.as_array().ok_or("Не удалось прочитать список клипов")?;
    let mut seen = HashSet::new();
    let mut clips = Vec::new();
    for item in rows {
        let Some(id) = item.get("clipId").and_then(value_id) else {
            continue;
        };
        if !requested.contains(&id) || !seen.insert(id.clone()) {
            continue;
        }
        let artists = item
            .get("artists")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(32)
            .filter_map(|raw| serde_json::from_value::<YArtist>(raw.clone()).ok())
            .map(|artist| map_artist(&artist))
            .collect();
        let track_ids = item
            .get("trackIds")
            .and_then(Value::as_array)
            .map(|ids| clip_ids(ids))
            .unwrap_or_default();
        let thumbnail = item
            .get("thumbnail")
            .and_then(Value::as_str)
            .or_else(|| item.get("cover").and_then(|cover| cover.get("uri")).and_then(Value::as_str));
        let duration_ms = item
            .get("duration")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0 && *seconds <= 24 * 60 * 60)
            .and_then(|seconds| seconds.checked_mul(1000));
        clips.push(ClipDto {
            id,
            title: text(item.get("title"), 512),
            artists,
            thumbnail_url: media_url(thumbnail, true),
            preview_url: media_url(item.get("previewUrl").and_then(Value::as_str), false),
            duration_ms,
            track_ids,
        });
        if clips.len() >= MAX_IDS {
            break;
        }
    }
    clips.sort_by_key(|clip| requested.iter().position(|id| id == &clip.id).unwrap_or(MAX_IDS));
    Ok(clips)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(API_USER_AGENT)
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Не удалось подготовить загрузку клипов".to_string())
}

fn status_error(status: u16) -> Option<String> {
    match status {
        200..=299 => None,
        401 => Some("Войди в Яндекс Музыку заново".to_string()),
        403 => Some("Нет доступа к клипу. Проверь подписку и ограничения аккаунта.".to_string()),
        404 => Some("Клип не найден или больше недоступен.".to_string()),
        451 => Some("Клип недоступен в твоём регионе.".to_string()),
        429 => Some("Яндекс Музыка ограничила запросы. Попробуй позже.".to_string()),
        _ => Some(format!("Не удалось загрузить клип: HTTP {status}")),
    }
}

fn request_url(value: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.port_or_known_default() != Some(443)
    {
        return None;
    }
    let allowed = match url.host_str()? {
        "api.music.yandex.net" => matches!(url.path(), "/tracks" | "/clips"),
        "frontend.vh.yandex.ru" => url.path().starts_with("/player/") && url.path().ends_with(".json"),
        _ => false,
    };
    allowed.then_some(url)
}

fn player_url(player_id: &str) -> Option<reqwest::Url> {
    if player_id.is_empty()
        || player_id.len() > 128
        || !player_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return None;
    }
    // Format observed in the official service by the referenced client implementation.
    request_url(&format!("{VH_BASE}/player/{player_id}.json?service=ya-music&from=ya-music&hidden=*"))
}

fn positive_flag(value: &Value, depth: usize) -> bool {
    if depth > 8 {
        return true;
    }
    match value {
        Value::Null => false,
        Value::Bool(enabled) => *enabled,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !matches!(text.trim().to_ascii_lowercase().as_str(), "" | "false" | "0" | "none" | "null" | "clear" | "disabled"),
        Value::Array(values) => values.iter().any(|value| positive_flag(value, depth + 1)),
        Value::Object(values) => values.values().any(|value| positive_flag(value, depth + 1)),
    }
}

fn protected(value: &Value) -> bool {
    [
        "drm", "drmConfig", "drm_config", "drmInfo", "drm_info", "isDrm", "is_drm",
        "hasDrm", "has_drm", "widevine", "playready", "fairplay", "clearkey",
        "keySystem", "key_system", "keySystems", "key_systems",
    ]
    .iter()
    .any(|key| value.get(*key).is_some_and(|flag| positive_flag(flag, 0)))
}

fn parse_stream(clip_id: &str, document: &Value) -> Result<ClipStreamDto, String> {
    if document.get("error").and_then(Value::as_str) == Some("old_browser") {
        return Err("Сервис клипов не поддержал запрос плеера. Попробуй обновить Aureon.".to_string());
    }
    if protected(document) {
        return Err(DRM_ERROR.to_string());
    }
    let content = document.get("content").ok_or("Яндекс Музыка не вернула поток клипа")?;
    if protected(content) {
        return Err(DRM_ERROR.to_string());
    }
    let streams = content.get("streams").and_then(Value::as_array).ok_or("Яндекс Музыка не вернула поток клипа")?;
    let protected_stream_available = streams.iter().any(protected);
    // Only documented fields from the observed response are considered; no URL regex fallback.
    for (stream_type, kind) in [("HLS", "hls"), ("MP4", "mp4")] {
        for stream in streams.iter().take(128) {
            if !stream.get("stream_type").and_then(Value::as_str).is_some_and(|value| value.eq_ignore_ascii_case(stream_type)) {
                continue;
            }
            if protected(stream) {
                continue;
            }
            if let Some(url) = media_url(stream.get("url").and_then(Value::as_str), false) {
                return Ok(ClipStreamDto { clip_id: clip_id.to_owned(), url, kind: kind.to_owned() });
            }
        }
    }
    if protected_stream_available {
        return Err(DRM_ERROR.to_string());
    }
    Err("Яндекс Музыка не вернула поддерживаемый поток клипа.".to_string())
}

fn json_request(http: &reqwest::Client, auth: &str, raw_url: &str) -> Result<reqwest::RequestBuilder, String> {
    // OAuth is sent only to these two fixed JSON services, never to stream/CDN URLs.
    let url = request_url(raw_url).ok_or("Неподдерживаемый адрес сервиса клипов")?;
    let user_agent = if url.host_str() == Some("frontend.vh.yandex.ru") { VH_USER_AGENT } else { API_USER_AGENT };
    Ok(http
        .get(url)
        .header("Authorization", auth)
        .header("User-Agent", user_agent)
        .header("X-Yandex-Music-Client", MUSIC_CLIENT)
        .header("Accept", "application/json"))
}

async fn json_at(http: &reqwest::Client, auth: &str, url: &str) -> Result<Value, String> {
    let mut response = json_request(http, auth, url)?
        .send()
        .await
        .map_err(|_| "Не удалось загрузить клипы Яндекс Музыки".to_string())?;
    if let Some(error) = status_error(response.status().as_u16()) {
        return Err(error);
    }
    if response.content_length().is_some_and(|length| length > MAX_BODY as u64) {
        return Err("Ответ со списком клипов слишком большой".to_string());
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Загрузка списка клипов прервана".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_BODY {
            return Err("Ответ со списком клипов слишком большой".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| "Не удалось прочитать ответ Яндекс Музыки".to_string())
}

async fn result(http: &reqwest::Client, auth: &str, path: &str) -> Result<Value, String> {
    let envelope = json_at(http, auth, &format!("{BASE}{path}")).await?;
    envelope.get("result").cloned().ok_or_else(|| "Яндекс Музыка не вернула список клипов".to_string())
}

impl Yandex {
    pub async fn track_clips(&self, track_id: &str) -> Result<Vec<ClipDto>, String> {
        let id = numeric_id(track_id).ok_or("Для этого трека клипы недоступны")?;
        let http = client()?;
        let auth = self.auth();
        // Same track lookup as Yandex::track, with a response limit and timeout here.
        let tracks = result(&http, &auth, &format!("/tracks?track-ids={id}")).await?;
        let track = tracks
            .as_array()
            .into_iter()
            .flatten()
            .find(|track| track.get("id").and_then(value_id).as_deref() == Some(id.as_str()))
            .cloned()
            .ok_or("Трек не найден")?;
        let track: YTrack = serde_json::from_value(track)
            .map_err(|_| "Не удалось прочитать данные трека".to_string())?;
        let ids = clip_ids(&track.clip_ids);
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let clips = result(&http, &auth, &format!("/clips?clipIds={}", ids.join(","))).await?;
        parse_clips(&clips, &ids)
    }

    pub async fn clip_stream(&self, clip_id: &str) -> Result<ClipStreamDto, String> {
        let id = numeric_id(clip_id).ok_or("Неверный идентификатор клипа")?;
        let http = client()?;
        let auth = self.auth();
        let clips = result(&http, &auth, &format!("/clips?clipIds={id}")).await?;
        let clip = clips.as_array().into_iter().flatten()
            .find(|clip| clip.get("clipId").and_then(value_id).as_deref() == Some(id.as_str()))
            .ok_or("Клип не найден")?;
        if protected(clip) {
            return Err(DRM_ERROR.to_string());
        }
        let player = clip.get("playerId").and_then(Value::as_str)
            .and_then(player_url).ok_or("Яндекс Музыка не вернула плеер клипа")?;
        // Resolve a fresh signed URL on every explicit playback request.
        let document = json_at(&http, &auth, player.as_str()).await?;
        parse_stream(&id, &document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn clip_ids_accept_positive_numeric_values_only_and_are_bounded() {
        let values = json!([1, "0001", "2", 0, -3, "", "0", " 4", "1&clipIds=5", 2.5, true, null, {}, "123456789012345678901"]);
        assert_eq!(clip_ids(values.as_array().unwrap()), vec!["1", "2"]);
        let many: Vec<Value> = (1..100).map(|id| json!(id)).collect();
        let bounded = clip_ids(&many);
        assert_eq!(bounded.len(), MAX_IDS);
        assert_eq!(bounded.last().unwrap(), "32");
    }

    #[test]
    fn clip_mapping_keeps_preview_distinct_from_duration_and_ignores_player_identifiers() {
        let clips = json!([{
            "clipId": 17, "title": "Official clip", "playerId": "not-a-url", "uuid": "not-a-stream",
            "duration": 210, "trackIds": [123, "00124", "../private"],
            "thumbnail": "avatars.yandex.net/get-music-content/cover/%%",
            "previewUrl": "https://cache-videos.yandex.net/preview.mp4?signature=abc",
            "artists": [{"id": 3, "name": "Artist"}]
        }, {"clipId": 19, "title": "Unrequested"}, {"clipId": 17, "title": "Duplicate"}]);
        let mapped = parse_clips(&clips, &["17".into()]).unwrap();
        assert_eq!(mapped.len(), 1);
        let clip = &mapped[0];
        assert_eq!(clip.id, "17");
        assert_eq!(clip.duration_ms, Some(210_000));
        assert_eq!(clip.track_ids, vec!["123", "124"]);
        assert_eq!(clip.artists[0].name, "Artist");
        assert_eq!(clip.thumbnail_url.as_deref(), Some("https://avatars.yandex.net/get-music-content/cover/640x360"));
        assert_eq!(clip.preview_url.as_deref(), Some("https://cache-videos.yandex.net/preview.mp4?signature=abc"));
        let serialized = serde_json::to_value(clip).unwrap();
        assert!(serialized.get("playerId").is_none());
        assert!(serialized.get("stream_url").is_none());
        assert!(parse_clips(&json!({"url":"https://example.com"}), &["17".into()]).is_err());
    }

    #[test]
    fn videoshots_do_not_create_full_clips_in_track_mapping() {
        let track: YTrack = serde_json::from_value(json!({
            "id": 123, "title": "Track", "backgroundVideoUri": "https://cache-videos.yandex.net/shot.mp4",
            "backgroundVideoId": "shot", "playerId": "shot-player"
        })).unwrap();
        assert!(super::super::map_track(&track).clip_ids.is_empty());
        let track: YTrack = serde_json::from_value(json!({"id":123,"clipIds":[17,"0018",0,"a"]})).unwrap();
        assert_eq!(super::super::map_track(&track).clip_ids, vec!["17", "18"]);
    }

    #[test]
    fn missing_null_or_malformed_clip_metadata_keeps_the_track_playable() {
        for value in [
            json!({"id":123,"title":"Track"}),
            json!({"id":123,"title":"Track","clipIds":null}),
            json!({"id":123,"title":"Track","clipIds":{}}),
            json!({"id":123,"title":"Track","clipIds":"not an array"}),
        ] {
            let track: YTrack = serde_json::from_value(value).unwrap();
            let mapped = super::super::map_track(&track);
            assert_eq!(mapped.id, "123");
            assert_eq!(mapped.title, "Track");
            assert!(mapped.available);
            assert!(mapped.clip_ids.is_empty());
        }
    }

    #[test]
    fn untrusted_media_urls_are_not_returned_to_the_webview() {
        for url in [
            "http://cache-videos.yandex.net/preview.mp4",
            "https://user:password@cache-videos.yandex.net/p.mp4",
            "https://cache-videos.yandex.net/p.mp4#fragment",
            "https://cache-videos.yandex.net:8443/p.mp4",
            "https://cache-videos.yandex.net.evil.test/p.mp4",
            "https://evil-yandex.net/p.mp4",
            "https://127.0.0.1/p.mp4", "https://[::1]/p.mp4", "https://localhost/p.mp4",
            "file:///C:/private/video.mp4", "javascript:alert(1)", "data:video/mp4,aaa",
            "https://cache-videos.yandex.net/\nprivate.mp4", "https://cache-videos.yandex.net\\evil.test/p.mp4",
        ] {
            assert!(media_url(Some(url), false).is_none(), "accepted {url}");
        }
        assert!(media_url(Some("https://cache-videos.yandex.net/p.mp4?sign=a%2Fb"), false).is_some());
        assert!(numeric_id("local:123").is_none());
        assert!(numeric_id("1?clipIds=2").is_none());
        let clips = parse_clips(&json!([{"clipId":17,"duration":-1,"previewUrl":"https://evil.test/p.mp4"}]), &["17".into()]).unwrap();
        assert_eq!(clips[0].duration_ms, None);
        assert_eq!(clips[0].preview_url, None);
    }

    #[test]
    fn full_stream_uses_structured_streams_and_preserves_the_signed_hls_url() {
        let source = json!({"content":{"streams":[
            {"stream_type":"DASH", "url":"https://strm.yandex.ru/video/master.mpd"},
            {"stream_type":"MP4", "url":"https://strm.yandex.ru/video/full.mp4"},
            {"stream_type":"HLS", "url":"https://strm.yandex.ru/video/master.m3u8?ysign1=abc%2Fxyz&expires=123"}
        ]}});
        let stream = parse_stream("17", &source).unwrap();
        assert_eq!(stream.clip_id, "17");
        assert_eq!(stream.kind, "hls");
        assert_eq!(stream.url, "https://strm.yandex.ru/video/master.m3u8?ysign1=abc%2Fxyz&expires=123");
        let mp4 = parse_stream("17", &json!({"content":{"streams":[{"stream_type":"mp4","url":"https://strm.yandex.ru/full.mp4"}]}})).unwrap();
        assert_eq!(mp4.kind, "mp4");
        assert!(parse_stream("17", &json!({"debug":"https://strm.yandex.ru/video/master.m3u8"})).is_err());
        assert!(parse_stream("17", &json!({"content":{"streams":[{"type":"HLS","url":"https://strm.yandex.ru/master.m3u8"}]}})).is_err());
        assert!(parse_stream("17", &json!({"content":{"streams":[{"stream_type":"HLS","url":"https://evil.test/master.m3u8"}]}})).is_err());
    }

    #[test]
    fn vh_browser_negotiation_returns_a_clear_hls_stream_for_dynasty() {
        // Public clip624687/player7043311152126062465, observed 2026-11-02.
        // Signed URL values are replaced in the fixture; response fields are preserved.
        let clear: Value = serde_json::from_str(include_str!("fixtures/clip_dynasty_vh.json")).unwrap();
        let stream = parse_stream("624687", &clear).unwrap();
        assert_eq!(stream.kind, "hls");
        assert_eq!(stream.clip_id, "624687");
        assert!(stream.url.ends_with("master.m3u8?ysign1=fixture"));

        let old_browser: Value = serde_json::from_str(include_str!("fixtures/clip_old_browser_vh.json")).unwrap();
        let error = parse_stream("624687", &old_browser).err().unwrap();
        assert!(error.contains("запрос плеера"));
        assert!(!error.contains("поддерживаемый поток"));
    }

    #[test]
    fn vh_json_uses_a_browser_agent_without_changing_metadata_or_oauth_destinations() {
        let http = client().unwrap();
        let auth = "OAuth test-only";
        let vh = player_url("7043311152126062465").unwrap();
        let request = json_request(&http, auth, vh.as_str()).unwrap().build().unwrap();
        assert_eq!(request.headers().get("user-agent").unwrap(), VH_USER_AGENT);
        assert_eq!(request.headers().get("authorization").unwrap(), auth);
        let metadata = json_request(&http, auth, "https://api.music.yandex.net/clips?clipIds=624687").unwrap().build().unwrap();
        assert_eq!(metadata.headers().get("user-agent").unwrap(), API_USER_AGENT);
        for url in ["https://strm.yandex.ru/master.m3u8", "https://evil.test/player/1.json", "https://frontend.vh.yandex.ru/redirect"] {
            assert!(json_request(&http, auth, url).is_err());
        }
    }

    #[test]
    fn explicit_drm_flags_block_playback_without_inspecting_arbitrary_text() {
        let clear = json!({"content":{"streams":[{"stream_type":"HLS","url":"https://strm.yandex.ru/master.m3u8"}]}});
        for (at, key, value) in [
            ("root", "drmConfig", json!({"widevine":{"licenseUrl":"https://licenses.yandex.ru"}})),
            ("content", "isDrm", json!(true)),
            ("stream", "drm_config", json!({"keySystem":"com.widevine.alpha"})),
            ("stream", "playready", json!({"licenseUrl":"https://licenses.yandex.ru"})),
        ] {
            let mut document = clear.clone();
            match at {
                "root" => document[key] = value,
                "content" => document["content"][key] = value,
                _ => document["content"]["streams"][0][key] = value,
            }
            assert_eq!(parse_stream("17", &document).err().as_deref(), Some(DRM_ERROR));
        }
        let mut disabled = clear.clone();
        disabled["drmConfig"] = json!({"enabled":false});
        disabled["content"]["drm"] = json!(false);
        disabled["content"]["streams"][0]["isDrm"] = json!(false);
        disabled["title"] = json!("The word Widevine in a title is not a DRM flag");
        assert!(parse_stream("17", &disabled).is_ok());
        assert_eq!(parse_stream("17", &json!({"drmConfig":{"keySystem":"widevine"}})).err().as_deref(), Some(DRM_ERROR));
    }

    #[test]
    fn clear_stream_is_selected_independently_of_other_protected_variants() {
        let mixed = json!({"content":{"streams":[
            {"stream_type":"DASH","url":"https://strm.yandex.ru/master.mpd","drmConfig":{"keySystem":"widevine"}},
            {"stream_type":"HLS","url":"https://strm.yandex.ru/protected.m3u8","isDrm":true},
            {"stream_type":"HLS","url":"https://strm.yandex.ru/clear.m3u8"}
        ]}});
        let clear = parse_stream("17", &mixed).unwrap();
        assert_eq!(clear.kind, "hls");
        assert_eq!(clear.url, "https://strm.yandex.ru/clear.m3u8");
        let mut all_protected = mixed.clone();
        all_protected["content"]["streams"][2]["drmConfig"] = json!({"keySystem":"widevine"});
        assert_eq!(parse_stream("17", &all_protected).err().as_deref(), Some(DRM_ERROR));
        let mut global = mixed;
        global["content"]["isDrm"] = json!(true);
        assert_eq!(parse_stream("17", &global).err().as_deref(), Some(DRM_ERROR));
    }

    #[test]
    fn player_id_cannot_change_the_fixed_vh_host_or_path() {
        let url = player_url("Abc_123-xy").unwrap();
        assert_eq!(url.as_str(), "https://frontend.vh.yandex.ru/player/Abc_123-xy.json?service=ya-music&from=ya-music&hidden=*");
        for player in ["", ".", "..", "../clips", "abc/def", "abc.json?service=other", "abc#fragment", "abc%2Fdef", "abc\\def", "https://evil.test", "a\nb", "игрок"] {
            assert!(player_url(player).is_none(), "accepted {player}");
        }
        assert!(player_url(&"a".repeat(129)).is_none());
        assert!(request_url("https://api.music.yandex.net/clips?clipIds=17").is_some());
        for url in [
            "https://evil.test/clips?clipIds=17", "https://api.music.yandex.net.evil.test/clips",
            "https://api.music.yandex.net:8443/clips", "https://user@api.music.yandex.net/clips",
            "http://frontend.vh.yandex.ru/player/abc.json", "https://frontend.vh.yandex.ru/other/abc.json",
            "https://strm.yandex.ru/master.m3u8", "https://api.music.yandex.net/clips#fragment",
        ] {
            assert!(request_url(url).is_none(), "would forward OAuth to {url}");
        }
    }

    #[test]
    fn region_subscription_and_auth_failures_have_distinct_messages() {
        assert!(status_error(200).is_none());
        assert!(status_error(451).unwrap().contains("регионе"));
        assert!(status_error(403).unwrap().contains("подписку"));
        assert!(status_error(401).unwrap().contains("заново"));
        assert_ne!(status_error(451), status_error(403));
    }
}
