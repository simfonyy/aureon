use base64::Engine;
use lofty::{
    config::WriteOptions,
    file::{AudioFile, TaggedFileExt},
    picture::{Picture, PictureType},
    prelude::{Accessor, ItemKey},
    tag::Tag,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const LIMIT: usize = 5000;
const CATALOG_BYTES: u64 = 48 * 1024 * 1024;
const AUDIO_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const RATE: u32 = 11025;
const ANALYSIS_SECONDS: usize = 180;
static CATALOG_LOCK: Mutex<()> = Mutex::new(());
static ANALYZING: AtomicBool = AtomicBool::new(false);
static IDENTIFYING: AtomicBool = AtomicBool::new(false);
static LAST_IDENTIFY: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioAnalysis {
    pub version: u32,
    pub bpm: Option<f32>,
    pub bpm_confidence: f32,
    pub key: Option<String>,
    pub key_confidence: f32,
    pub energy: f32,
    pub analyzed_seconds: f32,
    pub fingerprint: Vec<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub id: String,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub duration_ms: u64,
    pub size: u64,
    pub modified_at: u64,
    pub added_at: u64,
    pub cover_path: Option<String>,
    pub lyrics: String,
    pub analysis: Option<AudioAnalysis>,
}

#[derive(Default, Serialize, Deserialize)]
struct Catalog {
    version: u32,
    tracks: Vec<LocalEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub tracks: Vec<LocalEntry>,
    pub errors: Vec<String>,
    pub truncated: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagPatch {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    pub year: Option<u32>,
    pub track_number: Option<u32>,
    pub lyrics: String,
    pub cover_base64: Option<String>,
    pub remove_cover: bool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn clean(text: impl AsRef<str>, max: usize) -> String {
    text.as_ref()
        .chars()
        .filter(|ch| *ch != '\0')
        .take(max)
        .collect::<String>()
        .trim()
        .to_owned()
}
fn audio_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp3"
            | "flac"
            | "m4a"
            | "mp4"
            | "aac"
            | "ogg"
            | "opus"
            | "wav"
            | "aiff"
            | "aif"
            | "ape"
            | "wv"
            | "mpc"
    )
}
fn catalog_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_data_dir().map_err(err)?.join("library");
    fs::create_dir_all(&directory).map_err(err)?;
    Ok(directory.join("catalog-v1.json"))
}
fn load_catalog(app: &AppHandle) -> Result<Catalog, String> {
    let path = catalog_path(app)?;
    if !path.exists() {
        return Ok(Catalog {
            version: 1,
            tracks: vec![],
        });
    }
    if fs::metadata(&path).map_err(err)?.len() > CATALOG_BYTES {
        return Err("Файл библиотеки слишком большой".into());
    }
    let catalog: Catalog = serde_json::from_slice(&fs::read(path).map_err(err)?)
        .map_err(|_| "Не удалось прочитать библиотеку. Исходный файл сохранён")?;
    if catalog.version != 1 || catalog.tracks.len() > LIMIT {
        return Err("Неизвестный формат библиотеки".into());
    }
    let mut ids = HashSet::new();
    if catalog.tracks.iter().any(|entry| {
        !entry.id.starts_with("local:")
            || !ids.insert(&entry.id)
            || !Path::new(&entry.path).is_absolute()
            || entry.path.len() > 32768
            || entry.lyrics.len() > 256 * 1024
            || entry
                .analysis
                .as_ref()
                .is_some_and(|a| a.fingerprint.len() > 4096 || !a.energy.is_finite())
    }) {
        return Err("Повреждены записи библиотеки. Исходный файл сохранён".into());
    }
    Ok(catalog)
}
fn save_catalog(app: &AppHandle, catalog: &Catalog) -> Result<(), String> {
    let path = catalog_path(app)?;
    let bytes = serde_json::to_vec(catalog).map_err(err)?;
    if bytes.len() > CATALOG_BYTES as usize {
        return Err("Библиотека заполнена".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(err)?;
    temporary.write_all(&bytes).map_err(err)?;
    temporary.as_file().sync_all().map_err(err)?;
    temporary.persist(path).map_err(err)?;
    Ok(())
}
fn checked_file(path: &Path) -> Result<PathBuf, String> {
    let resolved = path.canonicalize().map_err(|_| "Файл не найден")?;
    let metadata = fs::metadata(&resolved).map_err(err)?;
    if !metadata.is_file() || !audio_extension(&resolved) {
        return Err("Неподдерживаемый аудиофайл".into());
    }
    if metadata.len() > AUDIO_BYTES {
        return Err("Файл больше 2 ГБ".into());
    }
    Ok(resolved)
}
fn path_id(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    let value = value.to_lowercase();
    format!("local:{:x}", Sha256::digest(value.as_bytes()))
}
fn modified(path: &Path) -> Result<(u64, u64), String> {
    let metadata = fs::metadata(path).map_err(err)?;
    Ok((
        metadata.len(),
        metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    ))
}
fn read_entry(
    app: &AppHandle,
    path: &Path,
    previous: Option<&LocalEntry>,
) -> Result<LocalEntry, String> {
    let path = checked_file(path)?;
    let tagged =
        lofty::read_from_path(&path).map_err(|e| format!("Не удалось прочитать теги: {e}"))?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let id = path_id(&path);
    let fallback = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let title = tag
        .and_then(|t| t.title())
        .map(|s| clean(s, 512))
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback);
    let (size, modified_at) = modified(&path)?;
    let mut cover_path = None;
    if let Some(picture) = tag.and_then(|t| {
        t.pictures()
            .iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| t.pictures().first())
    }) {
        let bytes = picture.data();
        if bytes.len() <= 8 * 1024 * 1024
            && (bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.starts_with(b"\xff\xd8\xff"))
        {
            let directory = app
                .path()
                .app_cache_dir()
                .map_err(err)?
                .join("library-covers");
            fs::create_dir_all(&directory).map_err(err)?;
            let ext = if bytes.starts_with(b"\xff\xd8") {
                "jpg"
            } else {
                "png"
            };
            let hash = format!("{:x}", Sha256::digest(bytes));
            let output = directory.join(format!("{}-{}.{ext}", &id[6..22], &hash[..12]));
            if !output.exists() {
                fs::write(&output, bytes).map_err(err)?;
            }
            cover_path = Some(output.to_string_lossy().to_string());
        }
    }
    let embedded = tag
        .and_then(|t| t.get_string(&ItemKey::Lyrics))
        .unwrap_or("");
    let lyrics = if embedded.is_empty() {
        let sidecar = path.with_extension("lrc");
        if fs::metadata(&sidecar).is_ok_and(|m| m.is_file() && m.len() <= 256 * 1024) {
            fs::read_to_string(sidecar).unwrap_or_default()
        } else {
            String::new()
        }
    } else {
        embedded.to_owned()
    };
    let analysis = previous
        .filter(|old| old.size == size && old.modified_at == modified_at)
        .and_then(|old| old.analysis.clone());
    Ok(LocalEntry {
        id,
        path: path.to_string_lossy().to_string(),
        title,
        artist: tag
            .and_then(|t| t.artist())
            .map(|s| clean(s, 512))
            .unwrap_or_default(),
        album: tag
            .and_then(|t| t.album())
            .map(|s| clean(s, 512))
            .unwrap_or_default(),
        genre: tag
            .and_then(|t| t.genre())
            .map(|s| clean(s, 256))
            .unwrap_or_default(),
        year: tag.and_then(|t| t.year()),
        track_number: tag.and_then(|t| t.track()),
        duration_ms: tagged.properties().duration().as_millis() as u64,
        size,
        modified_at,
        added_at: previous.map(|old| old.added_at).unwrap_or_else(now),
        cover_path,
        lyrics: clean(lyrics, 131072),
        analysis,
    })
}

#[tauri::command]
pub async fn library_catalog(app: AppHandle) -> Result<Vec<LocalEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        Ok(load_catalog(&app)?.tracks)
    })
    .await
    .map_err(err)?
}

fn collect_folder(root: &Path, files: &mut Vec<PathBuf>, depth: usize, truncated: &mut bool) {
    if depth > 8 || files.len() >= LIMIT {
        *truncated = true;
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if files.len() >= LIMIT {
            *truncated = true;
            break;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        let path = entry.path();
        if kind.is_dir() {
            collect_folder(&path, files, depth + 1, truncated);
        } else if kind.is_file() && audio_extension(&path) {
            files.push(path);
        }
    }
}

#[tauri::command]
pub async fn library_import(app: AppHandle, folder: bool) -> Result<ImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let picker = rfd::FileDialog::new().set_title(if folder {
            "Папка с музыкой"
        } else {
            "Добавить музыку"
        });
        let mut paths = vec![];
        let mut truncated = false;
        if folder {
            if let Some(root) = picker.pick_folder() {
                collect_folder(&root, &mut paths, 0, &mut truncated);
            }
        } else if let Some(files) = picker
            .add_filter(
                "Музыка",
                &[
                    "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "aiff", "ape", "wv", "mpc",
                ],
            )
            .pick_files()
        {
            paths = files;
        }
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let mut catalog = load_catalog(&app)?;
        let mut errors = vec![];
        for path in paths.into_iter().take(LIMIT) {
            let canonical = match checked_file(&path) {
                Ok(value) => value,
                Err(error) => {
                    if errors.len() < 100 {
                        errors.push(format!("{}: {error}", path.display()));
                    }
                    continue;
                }
            };
            let id = path_id(&canonical);
            let position = catalog.tracks.iter().position(|t| t.id == id);
            if position.is_none() && catalog.tracks.len() >= LIMIT {
                truncated = true;
                break;
            }
            match read_entry(&app, &canonical, position.map(|p| &catalog.tracks[p])) {
                Ok(entry) => {
                    if let Some(index) = position {
                        catalog.tracks[index] = entry
                    } else {
                        catalog.tracks.push(entry)
                    }
                }
                Err(error) => {
                    if errors.len() < 100 {
                        errors.push(format!("{}: {error}", path.display()));
                    }
                }
            }
        }
        save_catalog(&app, &catalog)?;
        Ok(ImportReport {
            tracks: catalog.tracks,
            errors,
            truncated,
        })
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn library_track_path(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let catalog = load_catalog(&app)?;
        let entry = catalog
            .tracks
            .iter()
            .find(|t| t.id == id)
            .ok_or("Трек удалён из библиотеки")?;
        Ok(checked_file(Path::new(&entry.path))?
            .to_string_lossy()
            .to_string())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn library_lyrics(app: AppHandle, id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let catalog = load_catalog(&app)?;
        Ok(catalog
            .tracks
            .iter()
            .find(|t| t.id == id)
            .ok_or("Трек удалён из библиотеки")?
            .lyrics
            .clone())
    })
    .await
    .map_err(err)?
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identification {
    pub recording_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub score: f32,
}

fn identification_results(bytes: &[u8]) -> Result<Vec<Identification>, String> {
    if bytes.len() > 1024 * 1024 {
        return Err("AcoustID вернул слишком большой ответ".into());
    }
    let response: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "Не удалось прочитать ответ AcoustID")?;
    if response.get("status").and_then(|s| s.as_str()) != Some("ok") {
        return Err(
            match response.pointer("/error/code").and_then(|v| v.as_u64()) {
                Some(4) => "AcoustID не принял ключ приложения",
                Some(3) => "AcoustID не принял отпечаток записи",
                Some(14) => "AcoustID временно ограничил запросы. Попробуй позже",
                _ => "AcoustID не смог выполнить поиск. Проверь ключ и попробуй позже",
            }
            .into(),
        );
    }
    let mut candidates: Vec<Identification> = vec![];
    let mut seen = HashMap::new();
    for result in response
        .get("results")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .take(100)
    {
        let score = result
            .get("score")
            .and_then(|v| v.as_f64())
            .filter(|v| v.is_finite())
            .unwrap_or(0.)
            .clamp(0., 1.) as f32;
        if score < 0.1 {
            continue;
        }
        for recording in result
            .get("recordings")
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
            .take(100)
        {
            let title = clean(
                recording
                    .get("title")
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
                512,
            );
            if title.is_empty() {
                continue;
            }
            let artist = recording
                .get("artists")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .take(20)
                .filter_map(|v| v.get("name").and_then(|v| v.as_str()))
                .map(|v| clean(v, 128))
                .filter(|v| !v.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            let recording_id = clean(
                recording.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                100,
            );
            let mut albums: Vec<String> = recording
                .get("releases")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .take(20)
                .chain(
                    recording
                        .get("releasegroups")
                        .and_then(|v| v.as_array())
                        .into_iter()
                        .flatten()
                        .take(20),
                )
                .filter_map(|v| v.get("title").and_then(|v| v.as_str()))
                .map(|v| clean(v, 512))
                .filter(|v| !v.is_empty())
                .collect();
            if albums.is_empty() {
                albums.push(String::new());
            }
            for album in albums {
                let key = (title.clone(), artist.clone(), album.clone());
                if let Some(index) = seen.get(&key).copied() {
                    let previous: &mut Identification = &mut candidates[index];
                    previous.score = previous.score.max(score);
                } else {
                    seen.insert(key, candidates.len());
                    candidates.push(Identification {
                        recording_id: recording_id.clone(),
                        title: title.clone(),
                        artist: clean(&artist, 512),
                        album,
                        score,
                    });
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.title.cmp(&b.title)));
    candidates.truncate(20);
    Ok(candidates)
}

fn identify_parameters(
    entry: &LocalEntry,
    client_key: String,
) -> Result<Vec<(&'static str, String)>, String> {
    let key = client_key.trim();
    if key.len() < 6
        || key.len() > 128
        || !key
            .bytes()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == b'_' || ch == b'-')
    {
        return Err("Введи ключ приложения AcoustID".into());
    }
    let analysis = entry
        .analysis
        .as_ref()
        .filter(|a| a.version == 1 && a.fingerprint.len() >= 16 && a.fingerprint.len() <= 4096)
        .ok_or("Сначала проанализируй запись")?;
    if entry.duration_ms < 1000 || entry.duration_ms > 86400000 {
        return Err("Не удалось определить длительность записи".into());
    }
    let config = rusty_chromaprint::Configuration::preset_test2();
    let compressed =
        rusty_chromaprint::FingerprintCompressor::from(&config).compress(&analysis.fingerprint);
    let fingerprint = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(compressed);
    Ok(vec![
        ("client", key.into()),
        ("duration", ((entry.duration_ms + 500) / 1000).to_string()),
        ("fingerprint", fingerprint),
        ("meta", "recordings releases releasegroups".into()),
        ("format", "json".into()),
    ])
}

struct IdentifyGuard;
impl Drop for IdentifyGuard {
    fn drop(&mut self) {
        IDENTIFYING.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn library_identify(
    app: AppHandle,
    id: String,
    client_key: String,
) -> Result<Vec<Identification>, String> {
    if IDENTIFYING.swap(true, Ordering::AcqRel) {
        return Err("Другой трек уже определяется".into());
    }
    let _guard = IdentifyGuard;
    {
        let mut last = LAST_IDENTIFY
            .lock()
            .map_err(|_| "Не удалось начать поиск")?;
        if last.is_some_and(|time| time.elapsed() < std::time::Duration::from_millis(400)) {
            return Err("Подожди секунду перед новым поиском".into());
        }
        *last = Some(Instant::now());
    }
    let parameters = tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let entry = load_catalog(&app)?
            .tracks
            .into_iter()
            .find(|t| t.id == id)
            .ok_or("Трек удалён из библиотеки")?;
        if modified(Path::new(&entry.path))? != (entry.size, entry.modified_at) {
            return Err("Запись изменилась. Сначала пересчитай анализ".into());
        }
        identify_parameters(&entry, client_key)
    })
    .await
    .map_err(|_| "Не удалось подготовить отпечаток записи")??;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Aureon/1.0 (manual audio identification)")
        .build()
        .map_err(|_| "Не удалось подключиться к AcoustID")?;
    let mut response = client
        .post("https://api.acoustid.org/v2/lookup")
        .form(&parameters)
        .send()
        .await
        .map_err(|_| "AcoustID не ответил. Проверь подключение и попробуй позже")?;
    let status = response.status();
    if status.as_u16() == 429 {
        return Err("AcoustID временно ограничил запросы. Попробуй позже".into());
    }
    if status.is_server_error() || status.is_redirection() {
        return Err("AcoustID сейчас недоступен. Попробуй позже".into());
    }
    if response
        .content_length()
        .is_some_and(|size| size > 1024 * 1024)
    {
        return Err("AcoustID вернул слишком большой ответ".into());
    }
    let mut bytes = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Не удалось получить ответ AcoustID")?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err("AcoustID вернул слишком большой ответ".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let result = identification_results(&bytes)?;
    if !status.is_success() {
        return Err("AcoustID не смог выполнить поиск".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn library_remove(app: AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let mut catalog = load_catalog(&app)?;
        catalog.tracks.retain(|t| t.id != id);
        save_catalog(&app, &catalog)
    })
    .await
    .map_err(err)?
}

fn cover_picture(value: &str) -> Result<Picture, String> {
    if value.len() > 11 * 1024 * 1024 {
        return Err("Обложка больше 8 МБ".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|_| "Не удалось прочитать обложку")?;
    if bytes.len() > 8 * 1024 * 1024
        || !(bytes.starts_with(b"\x89PNG\r\n\x1a\n") || bytes.starts_with(b"\xff\xd8\xff"))
    {
        return Err("Нужна обложка PNG или JPEG до 8 МБ".into());
    }
    let mut reader = std::io::Cursor::new(bytes);
    let mut picture = Picture::from_reader(&mut reader).map_err(err)?;
    picture.set_pic_type(PictureType::CoverFront);
    Ok(picture)
}

fn backup_tags_file(path: &Path) -> Result<PathBuf, String> {
    for index in 1..=1000 {
        let suffix = if index == 1 {
            ".aureon-tags.bak".to_owned()
        } else {
            format!(".aureon-tags.{index}.bak")
        };
        let mut name = path.as_os_str().to_os_string();
        name.push(suffix);
        let backup = PathBuf::from(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&backup) {
            Ok(mut output) => {
                let result = (|| -> std::io::Result<()> {
                    let mut original = fs::File::open(path)?;
                    std::io::copy(&mut original, &mut output)?;
                    output.flush()?;
                    output.sync_all()
                })();
                if let Err(error) = result {
                    drop(output);
                    // Only remove the new, incomplete copy owned by this call.
                    let _ = fs::remove_file(&backup);
                    return Err(format!("Не удалось сохранить резервную копию: {error}"));
                }
                return Ok(backup);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Не удалось сохранить резервную копию: {error}")),
        }
    }
    Err("Слишком много резервных копий тегов. Исходный файл не изменён.".into())
}

fn write_tags_file(path: &Path, patch: TagPatch) -> Result<(), String> {
    if patch.title.trim().is_empty()
        || patch.title.chars().count() > 512
        || patch.artist.chars().count() > 512
        || patch.album.chars().count() > 512
        || patch.genre.chars().count() > 256
        || patch.lyrics.chars().count() > 131072
        || patch.year.is_some_and(|y| y > 9999)
        || patch.track_number.is_some_and(|n| n > 9999)
    {
        return Err("Проверь поля тегов".into());
    }
    let picture = patch
        .cover_base64
        .as_deref()
        .map(cover_picture)
        .transpose()?;
    let mut tagged = lofty::read_from_path(&path).map_err(err)?;
    let tag_type = tagged.primary_tag_type();
    if tagged.primary_tag().is_none() {
        tagged.insert_tag(Tag::new(tag_type));
    }
    let tag = tagged
        .primary_tag_mut()
        .ok_or("Формат не поддерживает запись тегов")?;
    tag.set_title(clean(patch.title, 512));
    tag.set_artist(clean(patch.artist, 512));
    tag.set_album(clean(patch.album, 512));
    tag.set_genre(clean(patch.genre, 256));
    if let Some(year) = patch.year {
        tag.set_year(year);
    } else {
        tag.remove_year();
    }
    if let Some(number) = patch.track_number {
        tag.set_track(number);
    } else {
        tag.remove_track();
    }
    if patch.lyrics.is_empty() {
        tag.remove_key(&ItemKey::Lyrics);
    } else {
        tag.insert_text(ItemKey::Lyrics, patch.lyrics);
    }
    if patch.remove_cover || picture.is_some() {
        while !tag.pictures().is_empty() {
            tag.remove_picture(0);
        }
    }
    if let Some(picture) = picture {
        tag.push_picture(picture);
    }
    let temporary =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("Нет папки файла")?).map_err(err)?;
    fs::copy(&path, temporary.path()).map_err(err)?;
    tagged
        .save_to_path(temporary.path(), WriteOptions::default())
        .map_err(err)?;
    lofty::probe::Probe::open(temporary.path())
        .map_err(err)?
        .guess_file_type()
        .map_err(err)?
        .read()
        .map_err(|_| "Не удалось проверить изменённый файл")?;
    backup_tags_file(path)?;
    temporary.as_file().sync_all().map_err(err)?;
    temporary
        .persist(&path)
        .map_err(|e| format!("Не удалось заменить файл. Закрой его в других программах: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn library_edit_tags(
    app: AppHandle,
    id: String,
    patch: TagPatch,
) -> Result<LocalEntry, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let mut catalog = load_catalog(&app)?;
        let index = catalog
            .tracks
            .iter()
            .position(|t| t.id == id)
            .ok_or("Трек удалён из библиотеки")?;
        let previous = catalog.tracks[index].clone();
        let path = checked_file(Path::new(&previous.path))?;
        write_tags_file(&path, patch)?;
        let mut refreshed = read_entry(&app, &path, Some(&previous))?;
        // Tag edits do not change audio; the cached fingerprint remains valid.
        refreshed.analysis = previous.analysis;
        catalog.tracks[index] = refreshed.clone();
        save_catalog(&app, &catalog)?;
        Ok(refreshed)
    })
    .await
    .map_err(err)?
}

struct AnalysisGuard;
impl Drop for AnalysisGuard {
    fn drop(&mut self) {
        ANALYZING.store(false, Ordering::Release);
    }
}

fn decode_mono(path: &Path) -> Result<Vec<f32>, String> {
    use rubato::Resampler;
    use symphonia::core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
        io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    };
    let stream = MediaSourceStream::new(
        Box::new(fs::File::open(path).map_err(err)?),
        Default::default(),
    );
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(extension);
    }
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Не удалось открыть звук: {e}"))?
        .format;
    let track = format.default_track().ok_or("В файле нет звука")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Этот кодек пока нельзя проанализировать: {e}"))?;
    let mut samples = Vec::with_capacity(RATE as usize * ANALYSIS_SECONDS);
    let mut resampler: Option<rubato::SincFixedIn<f32>> = None;
    let mut pending = Vec::with_capacity(4096);
    let mut sample_rate = 0;
    let mut total_frames = 0usize;
    let mut delay = 0;
    fn append_output(output: Vec<Vec<f32>>, samples: &mut Vec<f32>, delay: &mut usize) {
        if let Some(channel) = output.first() {
            let skipped = (*delay).min(channel.len());
            *delay -= skipped;
            let remaining = RATE as usize * ANALYSIS_SECONDS - samples.len();
            samples.extend(channel.iter().skip(skipped).take(remaining).map(|s| {
                if s.is_finite() {
                    s.clamp(-1., 1.)
                } else {
                    0.
                }
            }));
        }
    }
    let started = Instant::now();
    let mut decode_errors = 0;
    while samples.len() < RATE as usize * ANALYSIS_SECONDS {
        if started.elapsed().as_secs() > 45 {
            return Err("Анализ занял слишком много времени".into());
        }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("Ошибка чтения звука: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(Error::DecodeError(_)) if decode_errors < 8 => {
                decode_errors += 1;
                continue;
            }
            Err(e) => return Err(format!("Ошибка декодирования: {e}")),
        };
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        if spec.rate == 0
            || spec.rate > 384000
            || channels == 0
            || channels > 8
            || decoded.capacity() > 262144
        {
            return Err("Неподдерживаемые параметры звука".into());
        }
        if resampler.is_none() {
            sample_rate = spec.rate;
            let next = rubato::SincFixedIn::<f32>::new(
                RATE as f64 / sample_rate as f64,
                1.,
                rubato::SincInterpolationParameters {
                    sinc_len: 64,
                    f_cutoff: 0.92,
                    oversampling_factor: 128,
                    interpolation: rubato::SincInterpolationType::Linear,
                    window: rubato::WindowFunction::Blackman2,
                },
                4096,
                1,
            )
            .map_err(err)?;
            delay = next.output_delay();
            resampler = Some(next);
        } else if sample_rate != spec.rate {
            return Err("Частота записи меняется внутри файла".into());
        }
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        buffer.copy_interleaved_ref(decoded);
        for frame in buffer.samples().chunks_exact(channels) {
            let mono =
                frame.iter().copied().filter(|s| s.is_finite()).sum::<f32>() / channels as f32;
            pending.push(mono.clamp(-1., 1.));
            total_frames += 1;
            if pending.len() == 4096 {
                let output = resampler
                    .as_mut()
                    .unwrap()
                    .process(&[pending.as_slice()], None)
                    .map_err(err)?;
                append_output(output, &mut samples, &mut delay);
                pending.clear();
            }
            if samples.len() >= RATE as usize * ANALYSIS_SECONDS {
                break;
            }
        }
    }
    if samples.len() < RATE as usize * ANALYSIS_SECONDS {
        if let Some(resampler) = resampler.as_mut() {
            let input = [pending.as_slice()];
            append_output(
                resampler.process_partial(Some(&input), None).map_err(err)?,
                &mut samples,
                &mut delay,
            );
            let target = (total_frames as u64 * RATE as u64 / sample_rate as u64) as usize;
            if samples.len() < target.min(RATE as usize * ANALYSIS_SECONDS) {
                append_output(
                    resampler
                        .process_partial::<&[f32]>(None, None)
                        .map_err(err)?,
                    &mut samples,
                    &mut delay,
                );
            }
            samples.truncate(target.min(RATE as usize * ANALYSIS_SECONDS));
        }
    }
    if samples.len() < RATE as usize {
        return Err("Слишком короткая запись для анализа".into());
    }
    Ok(samples)
}

fn correlation(a: &[f32], b: &[f32]) -> f32 {
    let mean_a = a.iter().sum::<f32>() / a.len() as f32;
    let mean_b = b.iter().sum::<f32>() / b.len() as f32;
    let (mut numerator, mut aa, mut bb) = (0., 0., 0.);
    for (a, b) in a.iter().zip(b) {
        let x = *a - mean_a;
        let y = *b - mean_b;
        numerator += x * y;
        aa += x * x;
        bb += y * y;
    }
    if aa * bb < 1e-12 {
        0.
    } else {
        numerator / (aa * bb).sqrt()
    }
}

fn analyze_samples(samples: &[f32]) -> AudioAnalysis {
    use rustfft::{num_complex::Complex, FftPlanner};
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len().max(1) as f32).sqrt();
    let energy = ((20. * rms.max(1e-7).log10() + 60.) / 60.).clamp(0., 1.);
    let mut result = AudioAnalysis {
        version: 1,
        bpm: None,
        bpm_confidence: 0.,
        key: None,
        key_confidence: 0.,
        energy,
        analyzed_seconds: samples.len() as f32 / RATE as f32,
        fingerprint: vec![],
    };
    if rms < 0.0001 {
        return result;
    }
    const SIZE: usize = 4096;
    const HOP: usize = 512;
    let fft = FftPlanner::<f32>::new().plan_fft_forward(SIZE);
    let mut buffer = vec![Complex::new(0., 0.); SIZE];
    let mut previous = vec![0.; SIZE / 2];
    let mut onset = vec![];
    let mut chroma = [0f32; 12];
    for frame in samples.windows(SIZE).step_by(HOP) {
        for (i, sample) in frame.iter().enumerate() {
            buffer[i] = Complex::new(
                *sample
                    * (0.5
                        - 0.5 * (2. * std::f32::consts::PI * i as f32 / (SIZE - 1) as f32).cos()),
                0.,
            );
        }
        fft.process(&mut buffer);
        let magnitudes: Vec<f32> = buffer[..SIZE / 2].iter().map(|bin| bin.norm()).collect();
        let maximum = magnitudes.iter().copied().fold(0f32, f32::max);
        let mut flux = 0.;
        let mut spectrum_energy = 0.;
        for k in 1..SIZE / 2 {
            let frequency = k as f32 * RATE as f32 / SIZE as f32;
            let magnitude = if magnitudes[k] > maximum * 0.0001 {
                magnitudes[k]
            } else {
                0.
            };
            if frequency >= 40. {
                flux += (magnitude - previous[k]).max(0.);
                spectrum_energy += magnitude;
            }
            previous[k] = magnitude;
            if k + 1 < SIZE / 2
                && (55. ..=4000.).contains(&frequency)
                && magnitude > maximum * 0.03
                && magnitude >= magnitudes[k - 1]
                && magnitude > magnitudes[k + 1]
            {
                // Interpolate isolated peaks; spreading every FFT bin across pitch classes
                // lets window leakage turn a major chord into its relative minor.
                let (left, center, right) = (
                    magnitudes[k - 1].max(1e-12).ln(),
                    magnitude.max(1e-12).ln(),
                    magnitudes[k + 1].max(1e-12).ln(),
                );
                let denominator = left - 2. * center + right;
                let delta = if denominator.abs() > 1e-8 {
                    (0.5 * (left - right) / denominator).clamp(-0.5, 0.5)
                } else {
                    0.
                };
                let peak_frequency = (k as f32 + delta) * RATE as f32 / SIZE as f32;
                let midi = (69. + 12. * (peak_frequency / 440.).log2()).round() as i32;
                chroma[midi.rem_euclid(12) as usize] += (magnitudes[k - 1] * magnitudes[k - 1]
                    + magnitude * magnitude
                    + magnitudes[k + 1] * magnitudes[k + 1])
                    .sqrt();
            }
        }
        onset.push((flux / spectrum_energy.max(1e-6) - 0.025).max(0.));
    }
    // Local mean removal reduces changes in volume unrelated to the pulse.
    let raw = onset.clone();
    for i in 0..onset.len() {
        let lo = i.saturating_sub(8);
        let hi = (i + 9).min(raw.len());
        onset[i] = (raw[i] - raw[lo..hi].iter().sum::<f32>() / (hi - lo) as f32).max(0.);
    }
    let frames_per_second = RATE as f32 / HOP as f32;
    let mut best = (0f32, 0usize);
    for lag in (60. * frames_per_second / 190.).floor() as usize
        ..=(60. * frames_per_second / 60.).ceil() as usize
    {
        if lag == 0 || onset.len() < lag * 4 {
            continue;
        }
        let score = correlation(&onset[lag..], &onset[..onset.len() - lag]).max(0.);
        if score > best.0 {
            best = (score, lag);
        }
    }
    if best.0 > 0.15 {
        result.bpm = Some((60. * frames_per_second / best.1 as f32 * 10.).round() / 10.);
        result.bpm_confidence = best.0.clamp(0., 1.);
    }
    let major = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ];
    let minor = [
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ];
    let names = [
        "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B",
    ];
    let mut scores = vec![];
    for root in 0..12 {
        for (profile, suffix) in [(&major, "major"), (&minor, "minor")] {
            let rotated: Vec<f32> = (0..12).map(|n| profile[(n + 12 - root) % 12]).collect();
            scores.push((
                correlation(&chroma, &rotated),
                format!("{} {suffix}", names[root]),
            ));
        }
    }
    scores.sort_by(|a, b| b.0.total_cmp(&a.0));
    if scores[0].0 > 0.4 && scores[0].0 - scores[1].0 > 0.015 {
        result.key = Some(scores[0].1.clone());
        result.key_confidence = ((scores[0].0 - scores[1].0) * 5.).clamp(0., 1.);
    }
    let mut printer =
        rusty_chromaprint::Fingerprinter::new(&rusty_chromaprint::Configuration::preset_test2());
    if printer.start(RATE, 1).is_ok() {
        let pcm: Vec<i16> = samples
            .iter()
            .map(|s| (s.clamp(-1., 1.) * 32767.).round() as i16)
            .collect();
        printer.consume(&pcm);
        printer.finish();
        result.fingerprint = printer.fingerprint().to_vec();
    }
    result
}

#[tauri::command]
pub async fn library_analyze(app: AppHandle, id: String) -> Result<LocalEntry, String> {
    if ANALYZING.swap(true, Ordering::AcqRel) {
        return Err("Другой трек уже анализируется".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _analysis = AnalysisGuard;
        let entry = {
            let _lock = CATALOG_LOCK.lock().map_err(err)?;
            load_catalog(&app)?
                .tracks
                .into_iter()
                .find(|t| t.id == id)
                .ok_or("Трек удалён из библиотеки")?
        };
        let path = checked_file(Path::new(&entry.path))?;
        let before = modified(&path)?;
        let samples = decode_mono(&path)?;
        let analysis = analyze_samples(&samples);
        if modified(&path)? != before {
            return Err("Файл изменился во время анализа. Запусти ещё раз".into());
        }
        let _lock = CATALOG_LOCK.lock().map_err(err)?;
        let mut catalog = load_catalog(&app)?;
        let track = catalog
            .tracks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or("Трек удалён из библиотеки")?;
        track.analysis = Some(analysis);
        track.size = before.0;
        track.modified_at = before.1;
        let refreshed = track.clone();
        save_catalog(&app, &catalog)?;
        Ok(refreshed)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
pub struct DuplicateGroup {
    pub ids: Vec<String>,
    pub similarity: f32,
}
#[derive(Serialize)]
pub struct DuplicateReport {
    pub groups: Vec<DuplicateGroup>,
    pub truncated: bool,
}

fn fingerprint_similarity(a: &[u32], b: &[u32]) -> f32 {
    if a.len().min(b.len()) < 64
        || a.iter().copied().collect::<HashSet<_>>().len() < 8
        || b.iter().copied().collect::<HashSet<_>>().len() < 8
    {
        return 0.;
    }
    let mut best = 0f32;
    for offset in -5i32..=5 {
        let aa = &a[offset.max(0) as usize..];
        let bb = &b[(-offset).max(0) as usize..];
        let length = aa.len().min(bb.len());
        let rough = (0..length)
            .step_by((length / 32).max(1))
            .map(|i| (aa[i] ^ bb[i]).count_ones())
            .sum::<u32>() as f32
            / (length.div_ceil((length / 32).max(1)) * 32) as f32;
        if rough > 0.18 {
            continue;
        }
        let difference = aa
            .iter()
            .zip(bb)
            .take(length)
            .map(|(x, y)| (x ^ y).count_ones())
            .sum::<u32>() as f32
            / (length * 32) as f32;
        best = best.max(1. - difference);
    }
    best
}

#[tauri::command]
pub async fn library_duplicate_groups(app: AppHandle) -> Result<DuplicateReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = {
            let _lock = CATALOG_LOCK.lock().map_err(err)?;
            load_catalog(&app)?
        };
        let mut tracks: Vec<_> = catalog
            .tracks
            .iter()
            .filter(|t| {
                t.analysis
                    .as_ref()
                    .is_some_and(|a| a.fingerprint.len() >= 64 && a.energy > 0.02)
                    && modified(Path::new(&t.path))
                        .is_ok_and(|value| value == (t.size, t.modified_at))
            })
            .collect();
        tracks.sort_by_key(|t| t.duration_ms);
        let mut parents: Vec<usize> = (0..tracks.len()).collect();
        fn root(parents: &[usize], mut index: usize) -> usize {
            while parents[index] != index {
                index = parents[index];
            }
            index
        }
        let started = Instant::now();
        let mut truncated = false;
        'outer: for i in 0..tracks.len() {
            for j in i + 1..tracks.len() {
                if tracks[j].duration_ms.abs_diff(tracks[i].duration_ms) > 2000 {
                    break;
                }
                if started.elapsed().as_secs() > 20 {
                    truncated = true;
                    break 'outer;
                }
                let a = tracks[i].analysis.as_ref().unwrap();
                let b = tracks[j].analysis.as_ref().unwrap();
                if fingerprint_similarity(&a.fingerprint, &b.fingerprint) >= 0.88 {
                    let first = root(&parents, i);
                    let second = root(&parents, j);
                    parents[second] = first;
                }
            }
        }
        let mut groups = vec![];
        for i in 0..tracks.len() {
            if root(&parents, i) != i {
                continue;
            }
            let members: Vec<usize> = (0..tracks.len())
                .filter(|j| root(&parents, *j) == i)
                .collect();
            if members.len() < 2 {
                continue;
            }
            let similarity = members
                .iter()
                .skip(1)
                .map(|j| {
                    fingerprint_similarity(
                        &tracks[i].analysis.as_ref().unwrap().fingerprint,
                        &tracks[*j].analysis.as_ref().unwrap().fingerprint,
                    )
                })
                .fold(1f32, f32::min);
            groups.push(DuplicateGroup {
                ids: members.iter().map(|j| tracks[*j].id.clone()).collect(),
                similarity,
            });
        }
        Ok(DuplicateReport { groups, truncated })
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_has_no_fake_tempo_key_or_fingerprint() {
        let result = analyze_samples(&vec![0.; RATE as usize * 3]);
        assert_eq!(result.bpm, None);
        assert_eq!(result.key, None);
        assert_eq!(result.energy, 0.);
        assert!(result.fingerprint.is_empty());
    }
    #[test]
    fn fingerprints_require_enough_audio_and_similar_bits() {
        assert_eq!(fingerprint_similarity(&[42; 8], &[42; 8]), 0.);
        let a: Vec<u32> = (0..256u32).map(|i| i.wrapping_mul(2654435761)).collect();
        let b: Vec<u32> = a.iter().map(|v| v ^ 1).collect();
        let unrelated: Vec<u32> = a.iter().map(|v| !v).collect();
        assert!(fingerprint_similarity(&a, &a) > 0.99);
        assert!(fingerprint_similarity(&a, &b) > 0.95);
        assert!(fingerprint_similarity(&a, &unrelated) < 0.88);
        assert_eq!(fingerprint_similarity(&[42; 256], &[42; 256]), 0.);
    }
    #[test]
    fn unsupported_files_and_bad_covers_are_rejected() {
        assert!(!audio_extension(Path::new("notes.txt")));
        assert!(audio_extension(Path::new("SONG.FLAC")));
        assert!(cover_picture("not an image").is_err());
        assert_eq!(clean("  a\0b  ", 20), "ab");
    }

    fn wav(path: &Path, rate: u32, samples: &[i16]) {
        let length = samples.len() as u32 * 2;
        let mut bytes = vec![];
        bytes.extend(b"RIFF");
        bytes.extend((36 + length).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(rate.to_le_bytes());
        bytes.extend((rate * 2).to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend(length.to_le_bytes());
        for sample in samples {
            bytes.extend(sample.to_le_bytes());
        }
        fs::write(path, bytes).unwrap();
    }
    fn patch() -> TagPatch {
        TagPatch { title:"New title".into(), artist:"Artist".into(), album:"Album".into(), genre:"Rock".into(), year:Some(2026), track_number:Some(2), lyrics:"[00:01.00]Words".into(), cover_base64:Some("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=".into()), remove_cover:false }
    }
    #[test]
    fn tag_edits_round_trip_real_wav_with_cover_and_backup_without_changing_audio() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("song.wav");
        let pcm: Vec<i16> = (0..RATE * 2)
            .map(|i| ((i as f32 * 0.2).sin() * 12000.) as i16)
            .collect();
        wav(&path, RATE, &pcm);
        let original = fs::read(&path).unwrap();
        let before = decode_mono(&path).unwrap();
        let existing_backup = directory.path().join("song.wav.aureon-tags.bak");
        fs::write(&existing_backup, b"earlier backup must survive").unwrap();
        write_tags_file(&path, patch()).unwrap();
        let first_edit = fs::read(&path).unwrap();
        let tagged = lofty::read_from_path(&path).unwrap();
        let tag = tagged.primary_tag().unwrap();
        assert_eq!(tag.title().as_deref(), Some("New title"));
        assert_eq!(tag.artist().as_deref(), Some("Artist"));
        assert_eq!(tag.year(), Some(2026));
        assert_eq!(tag.track(), Some(2));
        assert_eq!(tag.get_string(&ItemKey::Lyrics), Some("[00:01.00]Words"));
        assert_eq!(tag.pictures().len(), 1);
        assert_eq!(
            fs::read(directory.path().join("song.wav.aureon-tags.2.bak")).unwrap(),
            original
        );
        assert_eq!(fs::read(&existing_backup).unwrap(), b"earlier backup must survive");
        assert_eq!(decode_mono(&path).unwrap(), before);
        let mut removal = patch();
        removal.cover_base64 = None;
        removal.remove_cover = true;
        removal.year = None;
        removal.lyrics.clear();
        write_tags_file(&path, removal).unwrap();
        assert_eq!(fs::read(&existing_backup).unwrap(), b"earlier backup must survive");
        assert_eq!(fs::read(directory.path().join("song.wav.aureon-tags.2.bak")).unwrap(), original);
        assert_eq!(fs::read(directory.path().join("song.wav.aureon-tags.3.bak")).unwrap(), first_edit);
        assert_eq!(decode_mono(&path).unwrap(), before);
        let tagged = lofty::read_from_path(&path).unwrap();
        assert!(tagged.primary_tag().unwrap().pictures().is_empty());
        assert_eq!(tagged.primary_tag().unwrap().year(), None);
        assert!(tagged
            .primary_tag()
            .unwrap()
            .get_string(&ItemKey::Lyrics)
            .is_none());
        let saved = fs::read(&path).unwrap();
        let mut invalid = patch();
        invalid.title.clear();
        assert!(write_tags_file(&path, invalid).is_err());
        assert_eq!(fs::read(&path).unwrap(), saved);
    }
    #[test]
    fn sinc_resampling_keeps_duration_and_rejects_an_aliased_ultrasonic_tone() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tone.wav");
        let tone = |frequency: f32| -> Vec<i16> {
            (0..44100 * 2)
                .map(|i| {
                    ((2. * std::f32::consts::PI * frequency * i as f32 / 44100.).sin() * 20000.)
                        as i16
                })
                .collect()
        };
        wav(&path, 44100, &tone(1000.));
        let low = decode_mono(&path).unwrap();
        wav(&path, 44100, &tone(12000.));
        let high = decode_mono(&path).unwrap();
        assert_eq!(low.len(), RATE as usize * 2);
        assert_eq!(high.len(), low.len());
        let rms = |samples: &[f32]| {
            (samples[100..samples.len() - 100]
                .iter()
                .map(|v| v * v)
                .sum::<f32>()
                / (samples.len() - 200) as f32)
                .sqrt()
        };
        assert!(rms(&low) > 0.3);
        assert!(rms(&high) < 0.01);
    }
    #[test]
    fn rhythmic_music_produces_real_tempo_energy_and_chromaprint() {
        let samples: Vec<f32> = (0..RATE * 20)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                let pulse = (-45. * (t % 0.5)).exp();
                pulse
                    * ((2. * std::f32::consts::PI * 220. * t).sin()
                        + 0.5 * (2. * std::f32::consts::PI * 330. * t).sin())
                    * 0.5
            })
            .collect();
        let result = analyze_samples(&samples);
        assert!(result.bpm.is_some(), "No tempo: {result:?}");
        assert!(
            (result.bpm.unwrap() - 120.).abs() < 8.,
            "Unexpected tempo: {:?}",
            result.bpm
        );
        assert!(result.energy > 0.2 && result.energy < 1.);
        assert!(result.fingerprint.len() > 64);
        assert!(result.bpm_confidence > 0.15);
    }
    #[test]
    fn tonal_chord_is_identified_from_audio_instead_of_filename_or_tags() {
        let samples: Vec<f32> = (0..RATE * 12)
            .map(|i| {
                let t = i as f32 / RATE as f32;
                [261.6256, 329.6276, 391.9954]
                    .iter()
                    .map(|frequency| (2. * std::f32::consts::PI * frequency * t).sin() / 5.)
                    .sum()
            })
            .collect();
        let result = analyze_samples(&samples);
        assert_eq!(result.key.as_deref(), Some("C major"), "{result:?}");
        assert!(result.key_confidence > 0.);
        assert_eq!(result.bpm, None, "A static chord has no beat: {result:?}");
    }
    #[test]
    fn acoustid_candidates_parse_recordings_artists_albums_deduplicate_and_sort_without_network() {
        let bytes = serde_json::to_vec(&serde_json::json!({"status":"ok","results":[
            {"score":0.6,"recordings":[{"id":"recording","title":" Song ","artists":[{"name":"One"},{"name":"Two"}],"releases":[{"title":"Album"}],"releasegroups":[{"title":"Album"}]}]},
            {"score":0.95,"recordings":[{"id":"recording","title":"Song","artists":[{"name":"One"},{"name":"Two"}],"releases":[{"title":"Album"}]}]},
            {"score":0.8,"recordings":[{"id":"other","title":"Other","releasegroups":[{"title":"Collection"}]}]},
            {"score":0.9,"recordings":[{"title":"No album","artists":[{"name":"Artist"}]}]},
            {"score":0.01,"recordings":[{"title":"Unlikely"}]},{"score":1,"recordings":[null,{"title":""}]}
        ]})).unwrap();
        let results = identification_results(&bytes).unwrap();
        assert_eq!(results.len(), 3);
        assert_eq!(results[0].title, "Song");
        assert_eq!(results[0].artist, "One, Two");
        assert_eq!(results[0].album, "Album");
        assert_eq!(results[0].recording_id, "recording");
        assert!((results[0].score - 0.95).abs() < 0.0001);
        assert_eq!(results[1].album, "");
        assert_eq!(results[2].album, "Collection");
        assert!(identification_results(b"{broken").is_err());
        assert!(identification_results(&vec![b' '; 1024 * 1024 + 1]).is_err());
        assert!(identification_results(
            br#"{"status":"error","error":{"code":4,"message":"do-not-echo-key"}}"#
        )
        .unwrap_err()
        .contains("ключ"));
        assert!(!identification_results(
            br#"{"status":"error","error":{"code":4,"message":"do-not-echo-key"}}"#
        )
        .unwrap_err()
        .contains("do-not-echo-key"));
        assert!(identification_results(br#"{"status":"ok","results":[]}"#)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn acoustid_request_compresses_the_actual_algorithm_and_sends_only_client_duration_fingerprint_and_format(
    ) {
        let mut entry = LocalEntry {
            id: "local:test".into(),
            path: "C:/private-file-name.mp3".into(),
            title: "Private title".into(),
            artist: "Private artist".into(),
            album: String::new(),
            genre: String::new(),
            year: None,
            track_number: None,
            duration_ms: 240400,
            size: 100,
            modified_at: 1,
            added_at: 1,
            cover_path: None,
            lyrics: "Private lyrics".into(),
            analysis: Some(AudioAnalysis {
                version: 1,
                bpm: None,
                bpm_confidence: 0.,
                key: None,
                key_confidence: 0.,
                energy: 0.5,
                analyzed_seconds: 180.,
                fingerprint: (0..100u32).map(|n| n.wrapping_mul(2654435761)).collect(),
            }),
        };
        let params = identify_parameters(&entry, "local-test-client".into()).unwrap();
        let value = |key: &str| {
            params
                .iter()
                .find(|(name, _)| *name == key)
                .unwrap()
                .1
                .as_str()
        };
        assert_eq!(value("duration"), "240");
        assert_eq!(value("client"), "local-test-client");
        let compressed = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(value("fingerprint"))
            .unwrap();
        assert_eq!(
            compressed[0],
            rusty_chromaprint::Configuration::preset_test2().id()
        );
        assert_eq!(&compressed[1..4], &[0, 0, 100]);
        assert_eq!(params.len(), 5);
        assert!(!format!("{params:?}").contains("Private"));
        assert!(!format!("{params:?}").contains("private-file"));
        assert!(identify_parameters(&entry, "".into()).is_err());
        entry.analysis = None;
        assert!(identify_parameters(&entry, "local-test-client".into()).is_err());
    }
}
