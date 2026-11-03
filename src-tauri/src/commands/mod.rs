mod ai;
mod auth;
mod catalog;
mod discovery;
mod clips;
mod library;
mod playback;
mod radio;

pub use ai::*;
pub use auth::*;
pub use catalog::*;
pub use discovery::*;
pub use clips::*;
pub use library::*;
pub use playback::*;
pub use radio::*;

pub(crate) const DEFAULT_STATION: &str = "user:onyourwave";

#[derive(serde::Serialize)]
pub struct Ok_ {
    pub ok: bool,
}
