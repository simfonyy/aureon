use crate::{
    state::AppState,
    yandex::{HomeDiscoveryDto, Yandex},
};
use tauri::State;

#[tauri::command]
pub async fn get_home_discovery(state: State<'_, AppState>) -> Result<HomeDiscoveryDto, String> {
    let session = state.session()?;
    Yandex::new(&session.token)
        .home_discovery(session.uid)
        .await
}
