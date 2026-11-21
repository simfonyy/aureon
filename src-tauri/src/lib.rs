mod commands;
mod clip_sync;
mod clip_sync_media;
mod clip_sync_match;
mod updates;
mod gpu;
mod files;
mod library_tools;
mod listenbrainz;
mod audio_tools;
mod genius;
#[cfg(desktop)]
mod hotkeys;
mod lrclib;
mod lyrics_fx;
#[cfg(desktop)]
mod mini;
mod oauth;
mod presence;
mod proxy;
mod state;
mod together;
#[cfg(desktop)]
mod tray;
mod yandex;

use presence::DiscordState;
use state::AppState;
#[cfg(desktop)]
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
                let _ = app.emit("app://shown", ());
            }
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    #[cfg(target_os = "ios")]
    let builder = builder.plugin(tauri_plugin_opener::init());

    builder
        .register_asynchronous_uri_scheme_protocol(proxy::SCHEME, |_app, request, responder| {
            proxy::handle(request, responder);
        })
        .manage(AppState::default())
        .manage(DiscordState::default())
        .manage(together::TogetherState::default())
        .manage(together::relay::RelayState::default())
        .setup(|_app| {
            #[cfg(desktop)]
            {
                let app = _app;
                for (_, window) in app.webview_windows() {
                    if let Ok(icon) =
                        tauri::image::Image::from_bytes(include_bytes!("../icons/256x256.png"))
                    {
                        let _ = window.set_icon(icon);
                    }
                }
                tray::build(app.handle())?;
            }
            #[cfg(target_os = "ios")]
            {
                use objc2_avf_audio::{AVAudioSession, AVAudioSessionCategoryPlayback};
                let result = unsafe {
                    AVAudioSessionCategoryPlayback.map(|category| {
                        AVAudioSession::sharedInstance().setCategory_error(category)
                    })
                };
                if let Some(Err(error)) = result {
                    eprintln!("Aureon could not configure iOS audio: {error:?}");
                }
            }
            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(desktop)]
            let (window, event) = (_window, _event);
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::close_to_tray() {
                    api.prevent_close();
                    tray::hide(window.app_handle());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            clip_sync::get_clip_alignment,
            listenbrainz::listenbrainz_status,
            listenbrainz::listenbrainz_connect,
            listenbrainz::listenbrainz_set_enabled,
            listenbrainz::listenbrainz_disconnect,
            listenbrainz::listenbrainz_submit,
            listenbrainz::listenbrainz_recent,
            audio_tools::save_microphone_recording,
            library_tools::library_catalog,
            #[cfg(desktop)]
            library_tools::library_import,
            library_tools::library_track_path,
            library_tools::library_lyrics,
            library_tools::library_remove,
            library_tools::library_edit_tags,
            library_tools::library_analyze,
            library_tools::library_duplicate_groups,
            library_tools::library_identify,
            gpu::detect_gpu,
            updates::check_update,
            updates::download_update,
            commands::prefetch_stream,
            commands::clear_stream_cache,
            commands::auth_login,
            commands::auth_me,
            commands::auth_logout,
            oauth::oauth_device_start,
            oauth::oauth_cancel,
            commands::get_wave,
            commands::get_wheel,
            commands::get_artist,
            commands::get_artist_tracks,
            commands::get_album,
            commands::get_home_discovery,
            commands::wave_feedback,
            commands::search_tracks,
            commands::get_liked_tracks,
            commands::get_liked_ids,
            commands::get_disliked_ids,
            commands::set_like,
            commands::set_dislike,
            commands::get_stations,
            commands::station_info,
            commands::set_station_settings,
            commands::get_playlists,
            commands::get_playlist_tracks,
            commands::playlist_memberships,
            commands::playlist_add_track,
            commands::playlist_fill_from_queue,
            commands::playlist_remove_track,
            commands::playlist_move_track,
            commands::playlist_create,
            commands::playlist_rename,
            commands::playlist_set_visibility,
            commands::playlist_delete,
            commands::playlist_clear,
            commands::playlist_recommendations,
            commands::search_suggest,
            commands::get_similar_tracks,
            commands::get_track,
            commands::get_track_info,
            commands::get_track_clips,
            commands::get_clip_stream,
            commands::get_stream,
            commands::get_lyrics,
            lyrics_fx::analyze_lyrics_fx,
            lyrics_fx::cancel_lyrics_fx,
            commands::download_track,
            commands::download_image,
            commands::ai_check_artists,
            commands::ai_check_tracks,
            commands::default_download_dir,
            commands::find_local_track,
            commands::remove_local_track,
            commands::downloads_info,
            genius::genius_check,
            genius::genius_search,
            genius::search_lyrics,
            genius::genius_search_people,
            genius::genius_song,
            genius::genius_lookup,
            genius::genius_artist,
            genius::genius_clear_cache,
            lrclib::lrclib_lookup,
            lrclib::lrclib_clear_cache,
            presence::validate_discord_app,
            presence::update_discord_presence,
            presence::clear_discord_presence,
            presence::discord_presence_status,
            presence::reconnect_discord_presence,
            #[cfg(desktop)]
            tray::set_close_to_tray,
            #[cfg(desktop)]
            tray::set_tray_tooltip,
            #[cfg(desktop)]
            tray::hide_to_tray,
            #[cfg(desktop)]
            tray::show_from_tray,
            #[cfg(desktop)]
            tray::quit_app,
            #[cfg(desktop)]
            hotkeys::set_global_hotkeys,
            #[cfg(desktop)]
            hotkeys::clear_global_hotkeys,
            #[cfg(desktop)]
            mini::enter_mini_player,
            #[cfg(desktop)]
            mini::resize_mini_player,
            #[cfg(desktop)]
            mini::exit_mini_player,
            together::commands::together_host,
            together::commands::together_join,
            together::commands::together_leave,
            together::commands::together_send,
            together::commands::together_status,
            together::commands::together_peer_address,
            together::commands::together_log_path,
            together::relay::commands::together_relay_create,
            together::relay::commands::together_relay_join,
            together::relay::commands::together_relay_leave,
            together::relay::commands::together_relay_send,
            together::relay::commands::together_relay_handoff,
            together::relay::commands::together_relay_status,
            together::relay::commands::together_relay_seed_exists,
            together::relay::commands::together_relay_seed_show,
            together::relay::commands::together_relay_seed_set,
            together::relay::commands::together_relay_seed_new,
            together::relay::commands::together_relay_seed_forget,
            together::relay::commands::together_relay_identity,
            together::relay::commands::together_relay_invite,
            files::export_text_file,
            files::read_text_file,
            files::open_external,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Aureon");
}
