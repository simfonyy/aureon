use crate::lrclib::{parse_lrc, LrcLine};
use serde_json::Value;
use std::time::Duration;

fn normalize(value: &str) -> String {
    value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn matching_song(songs: &[Value], title: &str, artist: &str, duration_ms: Option<i64>) -> Option<i64> {
    let title = normalize(title);
    let artist = normalize(artist);
    if title.is_empty() || artist.is_empty() { return None; }
    songs.iter().filter_map(|song| {
        if normalize(song["name"].as_str()?) != title { return None; }
        if !song["artists"].as_array()?.iter().any(|a| a["name"].as_str().is_some_and(|n| normalize(n) == artist)) { return None; }
        let difference = match duration_ms.filter(|ms| *ms > 0) {
            Some(ms) => song["duration"].as_i64()?.abs_diff(ms),
            None => 0,
        };
        (difference <= 5000).then_some((difference, song["id"].as_i64()?))
    }).min_by_key(|(difference, _)| *difference).map(|(_, id)| id)
}

async fn request(path: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let body = crate::lrclib::http()?.get(format!("https://music.163.com/api/{path}"))
        .header("Referer", "https://music.163.com/").query(params)
        .timeout(Duration::from_secs(5)).send().await
        .and_then(|r| r.error_for_status()).map_err(|e| e.to_string())?
        .json::<Value>().await.map_err(|e| e.to_string())?;
    if body["code"].as_i64() != Some(200) { return Err("NetEase недоступен".into()); }
    Ok(body)
}

#[tauri::command]
pub async fn netease_lookup(title: String, artist: String, duration_ms: Option<i64>) -> Result<Vec<LrcLine>, String> {
    let query = format!("{artist} {title}");
    let result = request("search/get", &[("s", &query), ("type", "1"), ("limit", "12"), ("offset", "0")]).await?;
    let songs = result["result"]["songs"].as_array().map(Vec::as_slice).unwrap_or_default();
    let Some(id) = matching_song(songs, &title, &artist, duration_ms) else { return Ok(Vec::new()); };
    let result = request("song/lyric", &[("id", &id.to_string()), ("lv", "-1")]).await?;
    let lines = parse_lrc(result["lrc"]["lyric"].as_str().unwrap_or_default());
    if !lines.iter().any(|line| line.time_ms > 0 && !line.text.trim().is_empty()) { return Ok(Vec::new()); }
    Ok(lines)
}
