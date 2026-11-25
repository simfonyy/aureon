use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::Value;

use crate::lrclib::{http, parse_lrc, LrcLine};

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Catalog { Kugou, Qqmusic }

fn normalized(value: &str) -> String {
    value.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn matches(song: &Value, name: &str, artist: &str, title: &str) -> bool {
    song[name].as_str().is_some_and(|value| normalized(value) == title)
        && song["singer"].as_str().is_some_and(|value| normalized(value) == artist)
}

async fn get(url: &str, query: &[(&str, &str)], referer: &str) -> Result<Value, String> {
    http()?.get(url).query(query).header("Referer", referer).send().await
        .and_then(|response| response.error_for_status())
        .map_err(|_| "Каталог текстов недоступен".to_owned())?
        .json().await.map_err(|_| "Некорректный ответ каталога".to_owned())
}

fn decode(data: &Value) -> Result<Vec<LrcLine>, String> {
    let Some(encoded) = data.as_str() else { return Ok(Vec::new()); };
    let bytes = STANDARD.decode(encoded.trim()).map_err(|_| "Некорректная кодировка текста")?;
    let raw = std::str::from_utf8(&bytes).map_err(|_| "Некорректная кодировка текста")?;
    let lines = parse_lrc(raw.trim_start_matches('\u{feff}'));
    if lines.iter().any(|line| line.time_ms > 0 && !line.text.trim().is_empty()) {
        Ok(lines)
    } else {
        Ok(Vec::new())
    }
}

async fn lookup(catalog: Catalog, title: &str, artist: &str, duration: Option<i64>) -> Result<Vec<LrcLine>, String> {
    let keyword = format!("{artist} {title}");
    let title = normalized(title);
    let artist = normalized(artist);
    if title.is_empty() || artist.is_empty() { return Ok(Vec::new()); }

    match catalog {
        Catalog::Kugou => {
            let length = duration.unwrap_or_default().to_string();
            let query = [("ver","1"), ("man","yes"), ("client","pc"), ("keyword",&keyword), ("duration",&length)];
            let data = get("https://lyrics.kugou.com/search", &query, "https://www.kugou.com/").await?;
            let selected = data["candidates"].as_array().into_iter().flatten()
                .filter(|s| matches(s, "song", &artist, &title))
                .filter_map(|s| {
                    let delta = match duration {
                        Some(ms) => s["duration"].as_i64()?.abs_diff(ms),
                        None => 0,
                    };
                    (delta <= 5000).then_some((delta, s["id"].as_str()?, s["accesskey"].as_str()?))
                }).min_by_key(|item| item.0);
            let Some((_, id, key)) = selected else { return Ok(Vec::new()); };
            let query = [("ver","1"), ("client","pc"), ("id",id), ("accesskey",key), ("fmt","lrc"), ("charset","utf8")];
            let data = get("https://lyrics.kugou.com/download", &query, "https://www.kugou.com/").await?;
            decode(&data["content"])
        }
        Catalog::Qqmusic => {
            let data = get("https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg",
                &[("format","json"), ("key",&keyword)], "https://y.qq.com/").await?;
            let mid = data.pointer("/data/song/itemlist").and_then(Value::as_array)
                .into_iter().flatten().find(|s| matches(s, "name", &artist, &title))
                .and_then(|s| s["mid"].as_str());
            let Some(mid) = mid else { return Ok(Vec::new()); };
            let data = get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
                &[("format","json"), ("songmid",mid)], "https://y.qq.com/").await?;
            decode(&data["lyric"])
        }
    }
}

#[tauri::command]
pub async fn catalog_lyrics(catalog: Catalog, title: String, artist: String, duration_ms: Option<i64>) -> Result<Vec<LrcLine>, String> {
    tokio::time::timeout(Duration::from_secs(5), lookup(catalog, &title, &artist, duration_ms.filter(|ms| *ms > 0)))
        .await.map_err(|_| "Каталог текстов не ответил вовремя".to_owned())?
}
