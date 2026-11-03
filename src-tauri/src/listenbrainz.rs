use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

const SERVICE: &str = "ru.nightlezz.aureon.listenbrainz";
#[derive(Default, Serialize, Deserialize)]
pub struct Connection { pub user_name: String, pub enabled: bool }
fn entry() -> Result<keyring::Entry, String> { keyring::Entry::new(SERVICE, "token").map_err(|_| "Не удалось открыть хранилище ключей".into()) }
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> { Ok(app.path().app_data_dir().map_err(|e|e.to_string())?.join("listenbrainz.json")) }
fn config(app: &tauri::AppHandle) -> Connection { path(app).ok().and_then(|p|std::fs::read(p).ok()).and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default() }
fn save(app: &tauri::AppHandle, value: &Connection) -> Result<(), String> { let p=path(app)?;std::fs::create_dir_all(p.parent().unwrap()).map_err(|e|e.to_string())?;std::fs::write(p,serde_json::to_vec(value).unwrap()).map_err(|e|e.to_string()) }
fn client() -> Result<reqwest::Client, String> { reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).user_agent(concat!("Aureon/", env!("CARGO_PKG_VERSION"))).build().map_err(|_|"Не удалось подключиться к ListenBrainz".into()) }

async fn bounded_json(mut response:reqwest::Response,limit:usize)->Result<Value,String>{
    if response.content_length().map_or(false,|n|n>limit as u64){return Err("Ответ ListenBrainz слишком большой".into());}
    let mut body=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"Не удалось прочитать ответ ListenBrainz".to_string())?{if body.len().saturating_add(chunk.len())>limit{return Err("Ответ ListenBrainz слишком большой".into());}body.extend_from_slice(&chunk);}
    serde_json::from_slice(&body).map_err(|_|"Не удалось прочитать ответ ListenBrainz".into())
}

#[tauri::command]
pub fn listenbrainz_status(app: tauri::AppHandle) -> Connection { let mut c=config(&app);if entry().and_then(|e|e.get_password().map_err(|_|String::new())).is_err(){c=Connection::default();} c }
#[tauri::command]
pub async fn listenbrainz_connect(app: tauri::AppHandle, token: String) -> Result<Connection, String> {
    let token=token.trim();if token.len()<20 || token.len()>128 || !token.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'){return Err("Проверь токен ListenBrainz".into());}
    let response=client()?.get("https://api.listenbrainz.org/1/validate-token").header("Authorization",format!("Token {token}")).send().await.map_err(|_|"ListenBrainz недоступен".to_string())?.error_for_status().map_err(|_|"ListenBrainz не принял токен".to_string())?;
    let data=bounded_json(response,16*1024).await?;
    let name=data.get("user_name").and_then(Value::as_str).filter(|s|!s.is_empty()&&s.len()<=128).ok_or("Неверный токен ListenBrainz")?;
    if data.get("valid").and_then(Value::as_bool)!=Some(true){return Err("Неверный токен ListenBrainz".into());}
    entry()?.set_password(token).map_err(|_|"Не удалось сохранить токен в хранилище системы".to_string())?;
    let c=Connection{user_name:name.to_owned(),enabled:false};save(&app,&c)?;Ok(c)
}
#[tauri::command]
pub fn listenbrainz_set_enabled(app: tauri::AppHandle, enabled: bool) -> Result<Connection,String> { let mut c=listenbrainz_status(app.clone());if enabled&&c.user_name.is_empty(){return Err("Сначала подключи ListenBrainz".into());}c.enabled=enabled;save(&app,&c)?;Ok(c) }
#[tauri::command]
pub fn listenbrainz_disconnect(app: tauri::AppHandle) -> Result<(),String> { let _=entry()?.delete_credential();save(&app,&Connection::default()) }

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Listen { pub artist: String, pub title: String, pub album: Option<String>, pub duration_ms: u64, pub listened_at: u64 }
fn valid_listen(l:&Listen,now:u64)->bool { !l.artist.trim().is_empty()&&!l.title.trim().is_empty()&&l.artist.len()<=1024&&l.title.len()<=1024&&l.album.as_ref().map_or(true,|s|s.len()<=1024)&&l.duration_ms>0&&l.duration_ms<=24*60*60*1000&&l.listened_at>0&&l.listened_at<=now+300 }
#[tauri::command]
pub async fn listenbrainz_submit(app:tauri::AppHandle, listen:Listen)->Result<(),String>{
    let c=config(&app);if !c.enabled{return Err("Отправка прослушиваний выключена".into());}
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();if !valid_listen(&listen,now){return Err("Неверные данные прослушивания".into());}
    let token=entry()?.get_password().map_err(|_|"Подключи ListenBrainz заново".to_string())?;
    let mut metadata=json!({"artist_name":listen.artist,"track_name":listen.title,"additional_info":{"duration_ms":listen.duration_ms,"submission_client":"Aureon","submission_client_version":env!("CARGO_PKG_VERSION")}});
    if let Some(album)=listen.album.filter(|s|!s.is_empty()){metadata["release_name"]=json!(album);}
    client()?.post("https://api.listenbrainz.org/1/submit-listens").header("Authorization",format!("Token {token}")).json(&json!({"listen_type":"single","payload":[{"listened_at":listen.listened_at,"track_metadata":metadata}]})).send().await.map_err(|_|"Не удалось отправить прослушивание".to_string())?.error_for_status().map_err(|_|"ListenBrainz не принял прослушивание".to_string())?;Ok(())
}
#[tauri::command]
pub async fn listenbrainz_recent(app:tauri::AppHandle)->Result<Value,String>{ let c=config(&app);if c.user_name.is_empty(){return Err("Сначала подключи ListenBrainz".into());}let mut url=reqwest::Url::parse("https://api.listenbrainz.org/1/user/").unwrap();url.path_segments_mut().unwrap().pop_if_empty().push(&c.user_name).push("listens");url.query_pairs_mut().append_pair("count","30");let response=client()?.get(url).send().await.map_err(|_|"ListenBrainz недоступен".to_string())?.error_for_status().map_err(|_|"Не удалось загрузить историю".to_string())?;bounded_json(response,1024*1024).await }

#[cfg(test)] mod tests {use super::*;#[test]fn rejects_empty_or_future_listens(){let mut l=Listen{artist:"Artist".into(),title:"Track".into(),album:None,duration_ms:1000,listened_at:100};assert!(valid_listen(&l,100));l.listened_at=401;assert!(!valid_listen(&l,100));l.listened_at=100;l.artist.clear();assert!(!valid_listen(&l,100));}}
