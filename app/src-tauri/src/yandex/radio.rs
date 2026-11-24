use super::*;

#[derive(serde::Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct YRotorSession {
    radio_session_id: Option<String>,
    batch_id: Option<String>,
    sequence: Vec<YTrackWrap>,
}

impl Yandex {
    pub async fn wave_session(
        &self,
        station: &str,
        session_id: Option<&str>,
        queue: &[String],
        filters: Option<Vec<String>>,
    ) -> Result<WaveResponse, String> {
        let (path, body) = match session_id {
            Some(sid) => (
                format!("/rotor/session/{sid}/tracks"),
                serde_json::json!({ "queue": queue }),
            ),
            None => {
                let filters = match filters {
                    Some(filters) => filters,
                    None => self.station_info(station).await.map(|info| info.filters).unwrap_or_default(),
                };
                let mut seeds = vec![station.to_owned()];
                for filter in filters {
                    if !seeds.contains(&filter) {
                        seeds.push(filter);
                    }
                }
                ("/rotor/session/new".to_owned(), serde_json::json!({
                    "seeds": seeds, "includeTracksInResponse": true
                }))
            }
        };
        let result = self.post_value(&path, body).await?;
        let parsed: YRotorSession =
            serde_json::from_value(result).map_err(|e| e.to_string())?;
        let tracks = parsed
            .sequence
            .iter()
            .filter_map(|w| w.track.as_ref())
            .map(map_track)
            .collect();
        Ok(WaveResponse {
            station_id: station.to_string(),
            radio_session_id: parsed
                .radio_session_id
                .or_else(|| session_id.map(|s| s.to_string())),
            batch_id: parsed.batch_id,
            tracks,
        })
    }

    pub async fn wheel(&self) -> Result<Vec<WheelItemDto>, String> {
        let value = self.post_json("/wheel/new").await?;
        let mut out = Vec::new();
        let items = match value.get("items").and_then(|i| i.as_array()) {
            Some(arr) => arr,
            None => return Ok(out),
        };

        for item in items {
            let kind_raw = item
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_uppercase();
            let id = item
                .get("id")
                .map(val_to_id)
                .unwrap_or_default();
            let data = item.get("data");
            let item_desc = item.get("description").and_then(|v| v.as_str());

            match kind_raw.as_str() {
                "WAVE" => {
                    let wave = data.and_then(|d| d.get("wave"));
                    let agent = data.and_then(|d| d.get("agent"));
                    let seed = wave
                        .and_then(|w| w.get("seeds"))
                        .and_then(|s| s.as_array())
                        .and_then(|a| a.first())
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| id.clone());
                    out.push(WheelItemDto {
                        id: id.clone(),
                        kind: "wave".to_string(),
                        name: wave
                            .and_then(|w| w.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Волна")
                            .to_string(),
                        description: wave
                            .and_then(|w| w.get("description"))
                            .and_then(|v| v.as_str())
                            .or(item_desc)
                            .map(|s| s.to_string()),
                        cover_url: img(
                            agent
                                .and_then(|a| str_at(a, &["cover", "uri"]))
                                .as_deref(),
                            "400x400",
                        ),
                        color: agent.and_then(|a| str_at(a, &["cover", "color"])),
                        station: Some(seed),
                        artists: Vec::new(),
                    });
                }
                "ALBUM" => {
                    let album = data.and_then(|d| d.get("album"));
                    let artists = data
                        .and_then(|d| d.get("artists"))
                        .and_then(|a| a.as_array())
                        .map(|arr| {
                            arr.iter()
                                .map(|a| ArtistDto {
                                    id: a.get("id").map(val_to_id).unwrap_or_default(),
                                    name: a
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or_default()
                                        .to_string(),
                                    cover_url: img(
                                        str_at(a, &["cover", "uri"])
                                            .or_else(|| str_at(a, &["ogImage"]))
                                            .as_deref(),
                                        "200x200",
                                    ),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    let album_id = album
                        .and_then(|a| a.get("id"))
                        .map(val_to_id)
                        .unwrap_or_else(|| id.clone());
                    out.push(WheelItemDto {
                        id: album_id,
                        kind: "album".to_string(),
                        name: album
                            .and_then(|a| a.get("title"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Альбом")
                            .to_string(),
                        description: item_desc.map(|s| s.to_string()),
                        cover_url: img(
                            album.and_then(|a| str_at(a, &["cover", "uri"])).as_deref(),
                            "400x400",
                        ),
                        color: album.and_then(|a| str_at(a, &["cover", "color"])),
                        station: None,
                        artists,
                    });
                }
                "ARTIST" => {
                    let artist = data.and_then(|d| d.get("artist"));
                    let artist_id = artist
                        .and_then(|a| a.get("id"))
                        .map(val_to_id)
                        .unwrap_or_else(|| id.clone());
                    out.push(WheelItemDto {
                        id: artist_id,
                        kind: "artist".to_string(),
                        name: artist
                            .and_then(|a| a.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("Артист")
                            .to_string(),
                        description: item_desc.map(|s| s.to_string()),
                        cover_url: img(
                            artist.and_then(|a| str_at(a, &["cover", "uri"])).as_deref(),
                            "400x400",
                        ),
                        color: artist.and_then(|a| str_at(a, &["cover", "color"])),
                        station: None,
                        artists: Vec::new(),
                    });
                }
                _ => {}
            }
        }

        Ok(out)
    }

    pub async fn station_info(&self, station: &str) -> Result<StationInfoDto, String> {
        let result = self
            .get_result(&format!("/rotor/station/{station}/info"))
            .await?;
        let value = match result {
            serde_json::Value::Array(items) => items
                .into_iter()
                .next()
                .ok_or_else(|| "empty station info".to_string())?,
            other => other,
        };

        let station_obj = value.get("station").unwrap_or(&value);
        let settings = value
            .get("settings2")
            .or_else(|| value.get("settings"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let restrictions = station_obj
            .get("restrictions2")
            .or_else(|| station_obj.get("restrictions"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);

        Ok(StationInfoDto {
            id: station.to_string(),
            name: station_obj
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(station)
                .to_string(),
            filters: session_filters(&settings, &restrictions),
            language: setting_value(&settings, "language"),
            mood_energy: setting_value(&settings, "moodEnergy"),
            diversity: setting_value(&settings, "diversity"),
            languages: enum_options(&restrictions, "language"),
            moods: enum_options(&restrictions, "moodEnergy"),
            diversities: enum_options(&restrictions, "diversity"),
        })
    }

    pub async fn set_station_settings(
        &self,
        station: &str,
        language: Option<&str>,
        mood_energy: Option<&str>,
        diversity: Option<&str>,
    ) -> Result<bool, String> {
        let mut body = serde_json::Map::new();
        if let Some(v) = language {
            body.insert("language".into(), serde_json::Value::String(v.to_string()));
        }
        if let Some(v) = mood_energy {
            body.insert("moodEnergy".into(), serde_json::Value::String(v.to_string()));
        }
        if let Some(v) = diversity {
            body.insert("diversity".into(), serde_json::Value::String(v.to_string()));
        }
        if body.is_empty() {
            return Ok(false);
        }

        body.insert("type".into(), serde_json::json!("rotor"));
        let result = self.post_value(
            &format!("/rotor/station/{station}/settings3"),
            serde_json::Value::Object(body),
        ).await?;
        Ok(result.as_str() == Some("ok"))
    }

    pub async fn feedback(
        &self,
        station: &str,
        kind: &str,
        track_id: Option<&str>,
        batch_id: Option<&str>,
        total: Option<f64>,
    ) -> Result<bool, String> {
        let mut url = format!("{BASE}/rotor/station/{station}/feedback");
        if let Some(b) = batch_id {
            url.push_str(&format!("?batch-id={b}"));
        }
        let mut body = serde_json::json!({ "type": kind, "from": "mashiro" });
        if let Some(t) = track_id {
            body["trackId"] = serde_json::json!(t);
        }
        if let Some(s) = total {
            body["totalPlayedSeconds"] = serde_json::json!(s);
        }
        let resp = self
            .http
            .post(url)
            .header("Authorization", self.auth())
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        Ok(resp.status().is_success())
    }

    pub async fn stations(&self) -> Result<Vec<StationDto>, String> {
        let result = self.get_result("/rotor/stations/dashboard").await?;
        let mut out = Vec::new();
        if let Some(arr) = result.get("stations").and_then(|s| s.as_array()) {
            for item in arr {
                let st = item.get("station").unwrap_or(item);
                let id_obj = st.get("id");
                let kind = id_obj
                    .and_then(|i| i.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let tag = id_obj
                    .and_then(|i| i.get("tag"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if kind.is_empty() || tag.is_empty() {
                    continue;
                }
                let icon = st.get("icon");
                out.push(StationDto {
                    id: format!("{kind}:{tag}"),
                    name: st
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Станция")
                        .to_string(),
                    color: icon
                        .and_then(|i| i.get("backgroundColor"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                    icon_url: img(
                        icon.and_then(|i| i.get("imageUrl")).and_then(|v| v.as_str()),
                        "200x200",
                    ),
                });
            }
        }
        Ok(out)
    }
}

fn session_filters(settings: &serde_json::Value, restrictions: &serde_json::Value) -> Vec<String> {
    [
        ("moodEnergy", "settingMoodEnergy", "all"),
        ("diversity", "settingDiversity", "default"),
        ("language", "settingLanguage", "any"),
    ]
    .into_iter()
    .filter_map(|(key, prefix, unrestricted)| {
        let value = settings.get(key)?.as_str()?;
        let option = restrictions.get(key)?.get("possibleValues")?.as_array()?.iter()
            .find(|item| item["value"].as_str() == Some(value))?;
        if value == unrestricted || option["unspecified"].as_bool() == Some(true) {
            return None;
        }
        Some(match option["serializedSeed"].as_str().filter(|seed| !seed.is_empty()) {
            Some(seed) => seed.to_string(),
            None => format!("{prefix}:{value}"),
        })
    })
    .collect()
}

fn setting_value(settings: &serde_json::Value, key: &str) -> Option<String> {
    settings
        .get(key)
        .and_then(|v| v.as_str())
        .map(|v| v.to_string())
}

fn enum_options(restrictions: &serde_json::Value, key: &str) -> Vec<StationOptionDto> {
    restrictions
        .get(key)
        .and_then(|v| v.get("possibleValues"))
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let value = item.get("value").and_then(|v| v.as_str())?;
                    let name = item
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or(value)
                        .to_string();
                    Some(StationOptionDto {
                        value: value.to_string(),
                        name,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::session_filters;
    use serde_json::json;

    #[test]
    fn combines_station_options_and_uses_the_service_language_seed() {
        let restrictions = json!({
            "moodEnergy": {"possibleValues": [{"value": "calm"}, {"value": "all"}]},
            "diversity": {"possibleValues": [{"value": "discover"}, {"value": "default"}]},
            "language": {"possibleValues": [
                {"value": "local", "name": "Узбекский", "serializedSeed": "settingLanguage:uzbek"},
                {"value": "unrestricted", "unspecified": true}
            ]}
        });
        let settings = json!({"moodEnergy":"calm", "diversity":"discover", "language":"local"});
        assert_eq!(session_filters(&settings, &restrictions), [
            "settingMoodEnergy:calm", "settingDiversity:discover", "settingLanguage:uzbek",
        ]);
        let reset = json!({"moodEnergy":"all", "diversity":"default", "language":"unrestricted"});
        assert!(session_filters(&reset, &restrictions).is_empty());
        let partial = json!({"moodEnergy":"calm", "language":"unavailable"});
        assert_eq!(session_filters(&partial, &restrictions), ["settingMoodEnergy:calm"]);
    }
}
