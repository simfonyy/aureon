//! Optional local model bridge. Missing runtime leaves ordinary karaoke available.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const HELPER: &str = include_str!("../../scripts/lyrics-fx/selector.py");
const MODEL_SHA: &str = "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5";
static MODEL_LOCK: Mutex<()> = Mutex::new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxWord {
    id: String,
    text: String,
    start_ms: f64,
    end_ms: f64,
    line_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxLine {
    id: String,
    word_ids: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsFxRequest {
    source_key: String,
    transcript: String,
    words: Vec<FxWord>,
    lines: Vec<FxLine>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FxCandidate {
    word_id: String,
    #[serde(rename = "type")]
    effect: String,
    score: f64,
    reason: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsFxResponse {
    status: String,
    candidates: Vec<FxCandidate>,
    #[serde(default)]
    cache_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    model: Option<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    runtime_dir: PathBuf,
}

fn empty(status: &str, key: String) -> LyricsFxResponse {
    LyricsFxResponse {
        status: status.into(),
        candidates: vec![],
        cache_key: key,
        model: None,
    }
}

fn valid_request(request: &LyricsFxRequest) -> bool {
    if request.source_key.is_empty()
        || request.source_key.len() > 8192
        || request.transcript.len() > 100_000
        || request.words.is_empty()
        || request.words.len() > 600
        || request.lines.is_empty()
        || request.lines.len() > 600
    {
        return false;
    }
    let mut ids = HashMap::new();
    let mut previous = -1.0;
    for word in &request.words {
        if word.id.is_empty()
            || word.id.len() > 96
            || word.line_id.len() > 96
            || word.text.is_empty()
            || word.text.chars().count() > 256
            || !word.start_ms.is_finite()
            || !word.end_ms.is_finite()
            || word.start_ms < 0.0
            || word.start_ms < previous
            || word.end_ms < word.start_ms
            || word.end_ms > 86_400_000.0
            || ids
                .insert(word.id.as_str(), word.line_id.as_str())
                .is_some()
        {
            return false;
        }
        previous = word.start_ms;
    }
    let mut line_ids = HashSet::new();
    let mut assigned = HashSet::new();
    for line in &request.lines {
        if line.id.is_empty()
            || line.id.len() > 96
            || !line_ids.insert(line.id.as_str())
            || line.word_ids.is_empty()
        {
            return false;
        }
        for id in &line.word_ids {
            if ids.get(id.as_str()) != Some(&line.id.as_str()) || !assigned.insert(id.as_str()) {
                return false;
            }
        }
    }
    assigned.len() == ids.len()
}

fn valid_response(response: &LyricsFxResponse, request: &LyricsFxRequest) -> bool {
    if !matches!(response.status.as_str(), "ready" | "unavailable" | "error")
        || response.candidates.len() > 8
        || (response.status != "ready" && !response.candidates.is_empty())
    {
        return false;
    }
    let words: HashMap<_, _> = request
        .words
        .iter()
        .map(|word| (word.id.as_str(), word))
        .collect();
    let mut seen = HashSet::new();
    response.candidates.iter().all(|candidate| {
        words
            .get(candidate.word_id.as_str())
            .is_some_and(|word| word.end_ms - word.start_ms >= 70.0)
            && seen.insert(candidate.word_id.as_str())
            && matches!(candidate.effect.as_str(), "blood" | "impact")
            && candidate.score.is_finite()
            && (0.0..=1.0).contains(&candidate.score)
            && !candidate.reason.trim().is_empty()
            && candidate.reason.chars().count() <= 100
            && !candidate
                .reason
                .chars()
                .any(|c| c.is_control() || c == '<' || c == '>')
    })
}

fn cache_key(request: &LyricsFxRequest) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(b"aureon-lyrics-fx-cache-1\0");
    hash.update(MODEL_SHA);
    hash.update(HELPER.as_bytes());
    hash.update(serde_json::to_vec(request).map_err(|_| "Не удалось обработать текст.")?);
    Ok(hex::encode(hash.finalize()))
}

fn runtime_dir(config_dir: &Path) -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("AUREON_LYRICS_FX_RUNTIME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
    {
        return Some(path);
    }
    if let Ok(bytes) = fs::read(config_dir.join("lyrics-fx-runtime.json")) {
        if let Ok(config) = serde_json::from_slice::<RuntimeConfig>(&bytes) {
            if config.runtime_dir.is_absolute() && config.runtime_dir.is_dir() {
                return Some(config.runtime_dir);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let sibling = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()?
            .parent()?
            .join("karaoke-prototype");
        if sibling.is_dir() {
            return Some(sibling);
        }
    }
    None
}

fn python_path(runtime: &Path) -> Option<PathBuf> {
    let paths = if cfg!(windows) {
        vec![
            runtime.join(".venv/Scripts/python.exe"),
            runtime.join("python/python.exe"),
        ]
    } else {
        vec![
            runtime.join(".venv/bin/python3"),
            runtime.join("python/bin/python3"),
        ]
    };
    paths.into_iter().find(|path| path.is_file())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)?;
    fs::rename(temporary, path)
}

fn stop_helper(child: &mut Child) {
    // Drop the parent watch pipe first. Python then terminates its model process.
    child.stdin.take();
    let until = Instant::now() + Duration::from_secs(2);
    while Instant::now() < until {
        if child.try_wait().ok().flatten().is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn analyze_blocking(
    request: LyricsFxRequest,
    config_dir: PathBuf,
    cache_dir: PathBuf,
    generation: u64,
) -> Result<LyricsFxResponse, String> {
    if !valid_request(&request) {
        return Ok(empty("unavailable", String::new()));
    }
    let key = cache_key(&request)?;
    let directory = cache_dir.join("lyrics-fx").join(&key);
    let result_path = directory.join("result.json");
    if let Ok(bytes) = fs::read(&result_path) {
        if bytes.len() <= 64 * 1024 {
            if let Ok(response) = serde_json::from_slice::<LyricsFxResponse>(&bytes) {
                if response.cache_key == key
                    && response.status == "ready"
                    && valid_response(&response, &request)
                {
                    return Ok(response);
                }
            }
        }
    }
    let Some(runtime) = runtime_dir(&config_dir) else {
        return Ok(empty("unavailable", key));
    };
    let Some(python) = python_path(&runtime) else {
        return Ok(empty("unavailable", key));
    };
    let _permit = MODEL_LOCK
        .lock()
        .map_err(|_| "Не удалось подготовить эффекты.")?;
    if GENERATION.load(Ordering::SeqCst) != generation {
        return Ok(empty("unavailable", key));
    }
    fs::create_dir_all(&directory).map_err(|_| "Не удалось сохранить анализ текста.")?;
    let input = directory.join("input.json");
    atomic_write(
        &input,
        &serde_json::to_vec(&request).map_err(|_| "Не удалось обработать текст.")?,
    )
    .map_err(|_| "Не удалось сохранить текст для анализа.")?;
    let helper = directory.join("selector.py");
    atomic_write(&helper, HELPER.as_bytes())
        .map_err(|_| "Не удалось подготовить анализ текста.")?;
    let raw_result = directory.join("model-result.json");
    let log = fs::File::create(directory.join("helper.log"))
        .map_err(|_| "Не удалось подготовить анализ текста.")?;
    let mut command = Command::new(python);
    command
        .arg(&helper)
        .arg("--input")
        .arg(&input)
        .arg("--output")
        .arg(&raw_result)
        .arg("--runtime")
        .arg(runtime)
        .arg("--timeout")
        .arg("75")
        .arg("--watch-parent")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let Ok(mut child) = command.spawn() else {
        return Ok(empty("unavailable", key));
    };
    let deadline = Instant::now() + Duration::from_secs(95);
    loop {
        if GENERATION.load(Ordering::SeqCst) != generation || Instant::now() >= deadline {
            stop_helper(&mut child);
            return Ok(empty("unavailable", key));
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return Ok(empty("error", key));
                }
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(_) => {
                stop_helper(&mut child);
                return Ok(empty("error", key));
            }
        }
    }
    let bytes = fs::read(&raw_result).map_err(|_| "Не удалось прочитать результат анализа.")?;
    if bytes.len() > 64 * 1024 {
        return Ok(empty("error", key));
    }
    let Ok(mut response) = serde_json::from_slice::<LyricsFxResponse>(&bytes) else {
        return Ok(empty("error", key));
    };
    if !valid_response(&response, &request) {
        return Ok(empty("error", key));
    }
    response.cache_key = key;
    if response.status == "ready" {
        atomic_write(
            &result_path,
            &serde_json::to_vec(&response)
                .map_err(|_| "Не удалось сохранить результат анализа.")?,
        )
        .map_err(|_| "Не удалось сохранить результат анализа.")?;
    }
    Ok(response)
}

#[tauri::command]
pub async fn analyze_lyrics_fx(
    app: tauri::AppHandle,
    request: LyricsFxRequest,
) -> Result<LyricsFxResponse, String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let config_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Не удалось открыть данные приложения.")?;
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Не удалось открыть кеш приложения.")?;
    tauri::async_runtime::spawn_blocking(move || {
        analyze_blocking(request, config_dir, cache_dir, generation)
    })
    .await
    .map_err(|_| "Не удалось подготовить эффекты.")?
}

#[tauri::command]
pub fn cancel_lyrics_fx() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> LyricsFxRequest {
        LyricsFxRequest {
            source_key: "yandex:123|original".into(),
            transcript: "Сильный образ".into(),
            words: vec![
                FxWord {
                    id: "w0".into(),
                    text: "Сильный".into(),
                    start_ms: 0.0,
                    end_ms: 500.0,
                    line_id: "l0".into(),
                },
                FxWord {
                    id: "w1".into(),
                    text: "образ".into(),
                    start_ms: 500.0,
                    end_ms: 900.0,
                    line_id: "l0".into(),
                },
            ],
            lines: vec![FxLine {
                id: "l0".into(),
                word_ids: vec!["w0".into(), "w1".into()],
            }],
        }
    }

    #[test]
    fn cache_is_bound_to_source_text_and_timing() {
        let original = request();
        let key = cache_key(&original).unwrap();
        assert_eq!(key, cache_key(&request()).unwrap());
        let mut changed = request();
        changed.source_key = "local:replacement".into();
        assert_ne!(key, cache_key(&changed).unwrap());
        let mut changed = request();
        changed.words[0].text = "Другое".into();
        assert_ne!(key, cache_key(&changed).unwrap());
        let mut changed = request();
        changed.words[0].end_ms = 400.0;
        assert_ne!(key, cache_key(&changed).unwrap());
    }

    #[test]
    fn request_rejects_broken_word_ownership_and_times() {
        assert!(valid_request(&request()));
        let mut changed = request();
        changed.lines[0].word_ids.push("w0".into());
        assert!(!valid_request(&changed));
        let mut changed = request();
        changed.words[0].end_ms = f64::NAN;
        assert!(!valid_request(&changed));
        let mut changed = request();
        changed.words[1].line_id = "missing".into();
        assert!(!valid_request(&changed));
    }

    #[test]
    fn cached_model_choices_cannot_target_unknown_or_duplicate_words() {
        let mut response = empty("ready", String::new());
        response.candidates.push(FxCandidate {
            word_id: "w0".into(),
            effect: "blood".into(),
            score: 0.9,
            reason: "Образ фразы".into(),
        });
        assert!(valid_response(&response, &request()));
        response.candidates.push(response.candidates[0].clone());
        assert!(!valid_response(&response, &request()));
        response.candidates.pop();
        response.candidates[0].word_id = "missing".into();
        assert!(!valid_response(&response, &request()));
    }
}
