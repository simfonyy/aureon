use super::*;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

const LIMIT: usize = 40;
const RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const RUSSIA_CHART_PATH: &str = "/landing3/chart/russia";
type Albums = (Vec<DiscoveryAlbumDto>, Option<String>);

fn discovery_paths(uid: i64) -> Result<(String, String), String> {
    if uid <= 0 {
        return Err("Не удалось определить аккаунт Яндекс Музыки".into());
    }
    // The API requires eitherUserId even with OAuth. Always use this session's
    // UID; never reuse the example account ID from third-party client code.
    Ok((
        format!("/landing3?blocks=new-releases&eitherUserId={uid}"),
        format!("/landing3/new-releases?eitherUserId={uid}"),
    ))
}

// Landing uses Block/Entity; the dedicated chart also supports ChartInfo.
// Dedicated new releases contain IDs, not nested album objects.
fn id(value: &Value) -> Option<String> {
    let value = match value {
        Value::String(text) => text.trim().to_owned(),
        Value::Number(number) => number.as_u64()?.to_string(),
        _ => return None,
    };
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let canonical = value.trim_start_matches('0');
    (!canonical.is_empty()).then(|| canonical.to_owned())
}

fn text(value: Option<&Value>, limit: usize) -> Option<String> {
    let value = value?.as_str()?.trim();
    if value.is_empty() || value.chars().count() > limit {
        return None;
    }
    Some(value.to_owned())
}

fn artists(value: &Value) -> Vec<YArtist> {
    let mut seen = HashSet::new();
    value
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|artist| {
            let artist_id = id(artist.get("id")?)?;
            let name = text(artist.get("name"), 512)?;
            if !seen.insert(artist_id.clone()) {
                return None;
            }
            let mut mapped = serde_json::from_value::<YArtist>(artist.clone()).ok()?;
            mapped.id = Value::String(artist_id);
            mapped.name = Some(name);
            Some(mapped)
        })
        .take(LIMIT)
        .collect()
}

fn album(value: &Value) -> Option<DiscoveryAlbumDto> {
    Some(DiscoveryAlbumDto {
        id: id(value.get("id")?)?,
        title: text(value.get("title"), 512)?,
        cover_url: img(text(value.get("coverUri"), 2048).as_deref(), "400x400"),
        artists: artists(value).iter().map(map_artist).collect(),
        year: value
            .get("year")
            .and_then(Value::as_i64)
            .filter(|year| (1..=9999).contains(year)),
        release_date: text(value.get("releaseDate"), 64),
    })
}

fn chart_track(value: &Value) -> Option<TrackDto> {
    let track = YTrack {
        id: Value::String(id(value.get("id")?)?),
        title: Some(text(value.get("title"), 512)?),
        artists: artists(value),
        albums: value
            .get("albums")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|album| serde_json::from_value::<YAlbum>(album.clone()).ok())
            .filter(|album| id(&album.id).is_some())
            .take(LIMIT)
            .collect(),
        cover_uri: text(value.get("coverUri"), 2048),
        duration_ms: value
            .get("durationMs")
            .and_then(Value::as_i64)
            .filter(|duration| *duration > 0),
        available: value.get("available").and_then(Value::as_bool),
        clip_ids: value
            .get("clipIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|value| id(value).is_some())
            .take(LIMIT)
            .cloned()
            .collect(),
    };
    Some(map_track(&track))
}

fn entities<'a>(block: &'a Value, kind: &str) -> Result<&'a [Value], String> {
    if block.get("type").and_then(Value::as_str) != Some(kind) {
        return Err("Яндекс Музыка вернула другой раздел".into());
    }
    block
        .get("entities")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .ok_or_else(|| "Яндекс Музыка вернула неверный формат раздела".into())
}

fn releases_block(block: &Value) -> Result<Vec<DiscoveryAlbumDto>, String> {
    let mut seen = HashSet::new();
    let entities = entities(block, "new-releases")?;
    let items: Vec<_> = entities
        .iter()
        .filter(|entity| entity.get("type").and_then(Value::as_str) == Some("album"))
        .filter_map(|entity| album(entity.get("data")?))
        .filter(|album| seen.insert(album.id.clone()))
        .take(LIMIT)
        .collect();
    if !entities.is_empty() && items.is_empty() {
        return Err("Не удалось прочитать альбомы из новинок".into());
    }
    Ok(items)
}

fn chart_block(block: &Value) -> Result<Vec<TrackDto>, String> {
    let mut seen = HashSet::new();
    let entities = entities(block, "chart")?;
    let items: Vec<_> = entities
        .iter()
        .filter(|entity| entity.get("type").and_then(Value::as_str) == Some("chart-item"))
        .filter_map(|entity| chart_track(entity.get("data")?.get("track")?))
        .filter(|track| seen.insert(track.id.clone()))
        .take(LIMIT)
        .collect();
    if !entities.is_empty() && items.is_empty() {
        return Err("Не удалось прочитать треки чарта".into());
    }
    Ok(items)
}

fn chart_response(result: &Value) -> Result<Vec<TrackDto>, String> {
    if result.get("entities").is_some_and(Value::is_array) {
        return chart_block(result);
    }
    // Current MarshalX ChartInfo.chart is a Playlist; its tracks are
    // TrackShort objects with the complete Track under the track field.
    let tracks = result
        .get("chart")
        .and_then(|chart| chart.get("tracks"))
        .and_then(Value::as_array)
        .ok_or("Яндекс Музыка вернула неверный формат чарта")?;
    let mut seen = HashSet::new();
    let items: Vec<_> = tracks
        .iter()
        .filter_map(|item| chart_track(item.get("track")?))
        .filter(|track| seen.insert(track.id.clone()))
        .take(LIMIT)
        .collect();
    if !tracks.is_empty() && items.is_empty() {
        return Err("Не удалось прочитать треки чарта".into());
    }
    Ok(items)
}

fn landing_block<'a>(result: &'a Value, kind: &str) -> Result<&'a Value, String> {
    result
        .get("blocks")
        .and_then(Value::as_array)
        .ok_or("Яндекс Музыка вернула неверный формат главной")?
        .iter()
        .find(|block| block.get("type").and_then(Value::as_str) == Some(kind))
        .ok_or_else(|| "Раздел отсутствует в ответе Яндекс Музыки".into())
}

fn new_release_ids(result: &Value) -> Result<Vec<String>, String> {
    let values = result
        .get("newReleases")
        .and_then(Value::as_array)
        .ok_or("Яндекс Музыка вернула неверный список новинок")?;
    let mut seen = HashSet::new();
    let ids: Vec<_> = values
        .iter()
        .filter_map(id)
        .filter(|id| seen.insert(id.clone()))
        .take(LIMIT)
        .collect();
    if !values.is_empty() && ids.is_empty() {
        return Err("Не удалось прочитать список новинок".into());
    }
    Ok(ids)
}

fn hydrated_albums(result: &Value, requested: &[String]) -> Result<Albums, String> {
    let rows = result
        .as_array()
        .ok_or("Яндекс Музыка вернула неверный список альбомов")?;
    let mut seen = HashSet::new();
    let requested: Vec<_> = requested
        .iter()
        .filter(|id| seen.insert((*id).clone()))
        .take(LIMIT)
        .collect();
    let mut found = HashMap::new();
    for item in rows {
        if let Some(album) = album(item).filter(|album| seen.contains(&album.id)) {
            found.entry(album.id.clone()).or_insert(album);
        }
    }
    let albums: Vec<_> = requested
        .iter()
        .filter_map(|id| found.remove(*id))
        .collect();
    let failed = requested.len() - albums.len();
    if !requested.is_empty() && albums.is_empty() {
        return Err("Не удалось загрузить альбомы из новинок".into());
    }
    Ok((
        albums,
        if failed > 0 {
            Some(format!("Не удалось загрузить часть новинок ({failed})"))
        } else {
            None
        },
    ))
}

fn assemble(
    releases: Result<Albums, String>,
    chart: Result<Vec<TrackDto>, String>,
) -> HomeDiscoveryDto {
    let (new_releases, new_releases_error) = releases.unwrap_or_else(|error| (vec![], Some(error)));
    let (chart, chart_error) = match chart {
        Ok(items) => (items, None),
        Err(error) => (vec![], Some(error)),
    };
    HomeDiscoveryDto {
        new_releases,
        chart,
        new_releases_error,
        chart_error,
    }
}

impl Yandex {
    // Kept separate from get_result: discovery has explicit response/deadline
    // limits without changing existing catalog and playback request behavior.
    async fn discovery_result(&self, path: &str) -> Result<Value, String> {
        self.discovery_response(self.http.get(format!("{BASE}{path}")))
            .await
    }

    async fn discovery_response(&self, request: reqwest::RequestBuilder) -> Result<Value, String> {
        let mut response = request
            .header("Authorization", self.auth())
            .header("X-Yandex-Music-Client", MUSIC_CLIENT)
            .header("Accept-Language", "ru")
            .timeout(Duration::from_secs(8))
            .send()
            .await
            .map_err(|_| "Не удалось загрузить раздел Яндекс Музыки".to_owned())?;
        if response.status().as_u16() == 401 {
            return Err("Невалидный токен Яндекс Музыки".into());
        }
        if !response.status().is_success() {
            return Err(format!("Ошибка API Яндекса: {}", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|length| length > RESPONSE_BYTES as u64)
        {
            return Err("Ответ Яндекс Музыки слишком большой".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Не удалось прочитать раздел Яндекс Музыки")?
        {
            if bytes.len() + chunk.len() > RESPONSE_BYTES {
                return Err("Ответ Яндекс Музыки слишком большой".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| "Не удалось прочитать раздел Яндекс Музыки".to_owned())?
            .get("result")
            .filter(|result| !result.is_null())
            .cloned()
            .ok_or_else(|| "Яндекс Музыка не вернула раздел".into())
    }

    async fn discovery_releases(&self, path: &str) -> Result<Albums, String> {
        let ids = new_release_ids(&self.discovery_result(path).await?)?;
        if ids.is_empty() {
            return Ok((vec![], None));
        }
        // Verified AlbumsMixin._get_list uses POST /albums with album-ids.
        // One bounded batch request replaces per-album catalog requests.
        let response = self
            .discovery_response(
                self.http
                    .post(format!("{BASE}/albums"))
                    .form(&[("album-ids", ids.join(","))]),
            )
            .await?;
        hydrated_albums(&response, &ids)
    }

    pub async fn home_discovery(&self, uid: i64) -> Result<HomeDiscoveryDto, String> {
        let (landing_path, releases_path) = discovery_paths(uid)?;
        let (releases, chart) = tokio::join!(
            async {
                let landing = self.discovery_result(&landing_path).await;
                let releases = landing
                    .as_ref()
                    .map_err(Clone::clone)
                    .and_then(|result| landing_block(result, "new-releases"))
                    .and_then(releases_block)
                    .map(|albums| (albums, None));
                match releases {
                    Ok(items) => Ok(items),
                    Err(_) => self.discovery_releases(&releases_path).await,
                }
            },
            async {
                // Always request Russia explicitly. The landing chart and the
                // unqualified endpoint follow the listener's location.
                self.discovery_result(RUSSIA_CHART_PATH)
                    .await
                    .and_then(|result| chart_response(&result))
            }
        );
        Ok(assemble(releases, chart))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn discovery_paths_use_only_the_current_session_uid() {
        for uid in [17, 9042] {
            let (landing, releases) = discovery_paths(uid).unwrap();
            for path in [&landing, &releases] {
                let url = reqwest::Url::parse(&format!("{BASE}{path}")).unwrap();
                let values: Vec<_> = url
                    .query_pairs()
                    .filter(|(key, _)| key == "eitherUserId")
                    .map(|(_, value)| value.into_owned())
                    .collect();
                assert_eq!(values, vec![uid.to_string()]);
            }
        }
        assert!(discovery_paths(0).is_err());
        assert!(discovery_paths(-1).is_err());
    }

    #[test]
    fn public_chart_contract_with_sanitized_metadata_matches_the_production_parser() {
        let fixture: Value =
            serde_json::from_str(include_str!("fixtures/discovery_chart_public.json")).unwrap();
        let result = &fixture["result"];
        assert!(result["chart"].get("owner").is_none());
        let tracks = chart_response(result).unwrap();
        assert_eq!(tracks.len(), 3);
        assert_eq!(
            tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            vec!["100", "101", "102"]
        );
        assert!(tracks
            .iter()
            .all(|track| !track.artists.is_empty() && track.duration_ms.is_some()));
    }

    #[test]
    fn verified_landing_blocks_map_albums_and_chart_without_nulls_or_duplicates() {
        let fixture: Value =
            serde_json::from_str(include_str!("fixtures/discovery_landing.json")).unwrap();
        let result = &fixture["result"];
        let albums = releases_block(landing_block(result, "new-releases").unwrap()).unwrap();
        assert_eq!(albums.len(), 2);
        assert_eq!(albums[0].id, "10");
        assert_eq!(albums[0].title, "Album A");
        assert_eq!(albums[0].artists.len(), 1);
        assert_eq!(albums[0].artists[0].name, "Artist A");
        assert_eq!(albums[0].year, Some(2026));
        assert_eq!(
            albums[0].release_date.as_deref(),
            Some("2026-11-03T00:00:00+03:00")
        );
        assert_eq!(
            albums[0].cover_url.as_deref(),
            Some("https://avatars.yandex.net/album/400x400")
        );
        let chart = chart_block(landing_block(result, "chart").unwrap()).unwrap();
        assert_eq!(chart.len(), 2);
        assert_eq!(chart[0].id, "100");
        assert_eq!(chart[0].duration_ms, Some(180000));
        assert_eq!(chart[0].artists.len(), 1);
        assert_eq!(chart[0].album_id.as_deref(), Some("10"));
        assert_eq!(chart[0].clip_ids, vec!["5", "6"]);
        assert_eq!(chart[1].available, false);
    }

    #[test]
    fn dedicated_endpoints_accept_only_verified_ids_and_block_shapes() {
        let releases = json!({"newReleases":[10,"11",null,{"id":12},10,"",true,"bad/id"]});
        assert_eq!(new_release_ids(&releases).unwrap(), vec!["10", "11"]);
        let chart: Value =
            serde_json::from_str(include_str!("fixtures/discovery_chart.json")).unwrap();
        assert_eq!(chart_response(&chart["result"]).unwrap()[0].id, "100");
        let chart: Value =
            serde_json::from_str(include_str!("fixtures/discovery_chart_info.json")).unwrap();
        let tracks = chart_response(&chart["result"]).unwrap();
        assert_eq!(
            tracks
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            vec!["100", "101"]
        );
        assert!(new_release_ids(&json!({"albums":[]})).is_err());
        assert!(chart_block(&json!({"chart":{"tracks":[]}})).is_err());
        assert!(chart_response(&json!({"tracks":[]})).is_err());
    }

    #[test]
    fn empty_sections_are_valid_but_missing_or_malformed_sections_are_errors() {
        assert!(
            releases_block(&json!({"type":"new-releases","entities":[]}))
                .unwrap()
                .is_empty()
        );
        assert!(chart_block(&json!({"type":"chart","entities":[]}))
            .unwrap()
            .is_empty());
        assert!(chart_response(&json!({"chart":{"tracks":[]}}))
            .unwrap()
            .is_empty());
        assert!(landing_block(&json!({"blocks":[]}), "chart").is_err());
        assert!(landing_block(&Value::Null, "chart").is_err());
        assert!(chart_block(&json!({"type":"chart","entities":null})).is_err());
        assert!(chart_block(
            &json!({"type":"chart","entities":[null,{"type":"chart-item","data":{"track":{}}}]})
        )
        .is_err());
        assert!(new_release_ids(&json!({"newReleases":[null,{},0]})).is_err());
        assert_eq!(
            new_release_ids(&json!({"newReleases":["0010",10]})).unwrap(),
            vec!["10"]
        );
    }

    #[test]
    fn discovery_sections_are_bounded_and_do_not_repeat_ids() {
        let entities: Vec<_> = (0..100)
            .flat_map(|i| {
                vec![json!({"type":"album","data":{"id":i+1,"title":format!("Album {i}")}}); 2]
            })
            .collect();
        let albums = releases_block(&json!({"type":"new-releases","entities":entities})).unwrap();
        assert_eq!(albums.len(), LIMIT);
        assert_eq!(albums.last().unwrap().id, "40");
        let ids: Vec<_> = (1..100).map(|i| json!(i)).collect();
        assert_eq!(
            new_release_ids(&json!({"newReleases":ids})).unwrap().len(),
            LIMIT
        );
        let tracks: Vec<_> = (1..100)
            .flat_map(|id| vec![json!({"track":{"id":id,"title":"Track"}}); 2])
            .collect();
        let chart = chart_response(&json!({"chart":{"tracks":tracks}})).unwrap();
        assert_eq!(chart.len(), LIMIT);
        assert_eq!(chart.last().unwrap().id, "40");
    }

    #[test]
    fn batch_album_hydration_restores_release_order_and_reports_missing_albums() {
        let fixture: Value =
            serde_json::from_str(include_str!("fixtures/discovery_albums.json")).unwrap();
        let requested = vec!["10".to_owned(), "11".to_owned(), "12".to_owned()];
        let (albums, warning) = hydrated_albums(&fixture["result"], &requested).unwrap();
        assert_eq!(
            albums
                .iter()
                .map(|album| album.id.as_str())
                .collect::<Vec<_>>(),
            vec!["10", "11"]
        );
        assert_eq!(albums[0].title, "Album A");
        assert_eq!(
            warning.as_deref(),
            Some("Не удалось загрузить часть новинок (1)")
        );
        assert!(hydrated_albums(&json!([]), &requested).is_err());
        assert!(hydrated_albums(&json!({"albums":[]}), &requested).is_err());
        let (_, warning) = hydrated_albums(&fixture["result"], &requested[..2]).unwrap();
        assert!(warning.is_none());
    }

    #[test]
    fn unavailable_sections_keep_the_other_section_and_expose_the_error() {
        let chart = chart_block(&json!({"type":"chart","entities":[{"type":"chart-item","data":{"track":{"id":5,"title":"Track"}}}]})).unwrap();
        let result = assemble(Err("Не удалось загрузить новинки".into()), Ok(chart));
        assert!(result.new_releases.is_empty());
        assert_eq!(
            result.new_releases_error.as_deref(),
            Some("Не удалось загрузить новинки")
        );
        assert_eq!(result.chart.len(), 1);
        assert!(result.chart_error.is_none());
        let result = assemble(Ok((vec![], None)), Err("Чарт недоступен".into()));
        assert!(result.new_releases_error.is_none());
        assert_eq!(result.chart_error.as_deref(), Some("Чарт недоступен"));
    }
}
