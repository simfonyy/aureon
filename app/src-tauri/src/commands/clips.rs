use tauri::State;

use crate::state::AppState;
use crate::yandex::{ClipDto, ClipStreamDto, Yandex};

#[tauri::command]
pub async fn get_track_clips(
    id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ClipDto>, String> {
    let session = state.session()?;
    Yandex::new(&session.token).track_clips(&id).await
}

#[tauri::command]
pub async fn get_clip_stream(
    id: String,
    state: State<'_, AppState>,
) -> Result<ClipStreamDto, String> {
    let session = state.session()?;
    Yandex::new(&session.token).clip_stream(&id).await
}
