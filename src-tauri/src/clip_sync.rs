use std::{sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock}, time::{Duration, Instant}};
use tauri::State;
use crate::{clip_sync_match::{align_audio, ClipAlignment}, clip_sync_media::load_audio_pair, state::AppState, yandex::Yandex};

const TTL: Duration = Duration::from_secs(6 * 60 * 60);
const LIMIT: usize = 48;
static BUSY: AtomicBool = AtomicBool::new(false);
type CacheEntry = ((i64, String, String), ClipAlignment, Instant);
static CACHE: OnceLock<Mutex<Vec<CacheEntry>>> = OnceLock::new();
struct AnalysisGuard;
impl Drop for AnalysisGuard { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
fn id(value: &str) -> bool { !value.is_empty() && value.len() <= 20 && value.bytes().all(|b| b.is_ascii_digit()) && !value.starts_with('0') }
fn full_audio(expected_ms: Option<i64>, samples: usize, rate: u32) -> bool {
    let Some(ms) = expected_ms.filter(|ms| *ms > 0) else { return false; };
    if rate == 0 { return false; }
    let expected = (ms as f64 / 1000.0).min(300.0);
    (samples as f64 / f64::from(rate) - expected).abs() <= 1.5
}

#[tauri::command]
pub async fn get_clip_alignment(track_id: String, clip_id: String, state: State<'_, AppState>) -> Result<ClipAlignment, String> {
    if !id(&track_id) || !id(&clip_id) { return Err("Не удалось определить трек клипа.".into()); }
    let session = state.session()?;
    let key = (session.uid, track_id.clone(), clip_id.clone());
    if let Ok(mut entries) = CACHE.get_or_init(|| Mutex::new(Vec::new())).lock() {
        entries.retain(|(_, _, at)| at.elapsed() < TTL);
        if let Some((_, alignment, _)) = entries.iter().find(|(saved, _, _)| saved == &key) { return Ok(alignment.clone()); }
    }
    if BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("Предыдущий клип ещё синхронизируется. Попробуй включить этот чуть позже.".into());
    }
    let guard = AnalysisGuard;
    let yandex = Yandex::new(&session.token);
    let metadata = tokio::time::timeout(Duration::from_secs(12), yandex.track(&track_id))
        .await.map_err(|_| "Не удалось проверить версию трека.".to_string())??;
    if metadata.id != track_id || !metadata.available || !metadata.clip_ids.contains(&clip_id) {
        return Err("Клип не относится к этой версии трека.".into());
    }
    // All media stays on this computer. Signed URLs and PCM are never persisted.
    let (track, clip, rate) = tokio::time::timeout(Duration::from_secs(90), load_audio_pair(&track_id, &clip_id, &yandex))
        .await.map_err(|_| "Синхронизация клипа заняла слишком много времени.".to_string())??;
    // A 30-second service preview is not a verified timeline for the full song.
    if !full_audio(metadata.duration_ms, track.len(), rate) {
        return Err("Для синхронизации нужна полная аудиоверсия трека.".into());
    }
    let alignment = tokio::task::spawn_blocking(move || { let _guard = guard; align_audio(&track, &clip, rate) })
        .await.map_err(|_| "Не удалось сравнить звук клипа.".to_string())??;
    if alignment.confidence < 0.8 || alignment.matched_windows < 3 || !alignment.offset_seconds.is_finite() {
        return Err("Звук клипа не совпал с версией трека.".into());
    }
    if let Ok(mut entries) = CACHE.get_or_init(|| Mutex::new(Vec::new())).lock() {
        entries.push((key, alignment.clone(), Instant::now()));
        if entries.len() > LIMIT { entries.remove(0); }
    }
    Ok(alignment)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn alignment_identifiers_are_only_canonical_service_ids() {
        assert!(id("153919218")); assert!(id("624687"));
        for bad in ["", "0", "001", "local:123", "1:2", "../1", "1?x=2", "1\n", "123456789012345678901"] { assert!(!id(bad)); }
    }
    #[test] fn service_preview_cannot_be_cached_as_full_song_alignment() {
        assert!(!full_audio(Some(150_420), 30 * 4000, 4000));
        assert!(full_audio(Some(150_420), 601680, 4000));
        assert!(full_audio(Some(450_000), 300 * 4000, 4000));
        assert!(!full_audio(None, 300 * 4000, 4000));
        assert!(!full_audio(Some(150_420), 0, 0));
    }
}
