use std::{fs, io::Write, path::{Path, PathBuf}};
use base64::Engine;
use tauri::Manager;

const MAX_RECORDING_BYTES: usize = 32 * 1024 * 1024;

fn recording_data(mime: &str, encoded: &str) -> Result<(Vec<u8>, &'static str), String> {
    if encoded.len() > (MAX_RECORDING_BYTES + 2) / 3 * 4 { return Err("Запись больше 32 МБ".into()); }
    let data = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Неверные данные записи")?;
    if data.len() < 16 || data.len() > MAX_RECORDING_BYTES { return Err("Неверный размер записи".into()); }
    let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let extension = match mime.as_str() {
        "audio/webm" if data.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) => "webm",
        "audio/ogg" if data.starts_with(b"OggS") => "ogg",
        "audio/mp4" if &data[4..8] == b"ftyp" => "m4a",
        _ => return Err("Формат записи не поддерживается".into()),
    };
    Ok((data, extension))
}

fn save_recording(directory: &Path, name: &str, extension: &str, data: &[u8]) -> Result<PathBuf, String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let name: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c }).take(100).collect();
    // Prefix also avoids reserved Windows device names such as CON or AUX.
    let name = format!("Запись — {}", name.trim().trim_end_matches('.'));
    for index in 0..1000 {
        let suffix = if index == 0 { String::new() } else { format!(" ({})", index + 1) };
        let path = directory.join(format!("{name}{suffix}.{extension}"));
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut output) => {
                if let Err(error) = output.write_all(data) { drop(output); let _ = fs::remove_file(&path); return Err(error.to_string()); }
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Слишком много записей с таким названием".into())
}

#[tauri::command]
pub async fn save_microphone_recording(app: tauri::AppHandle, name: String, mime: String, recording_base64: String) -> Result<String, String> {
    let directory = app.path().audio_dir().or_else(|_| app.path().download_dir()).map_err(|e| e.to_string())?.join("Aureon").join("Записи");
    tauri::async_runtime::spawn_blocking(move || {
        let (data, extension) = recording_data(&mime, &recording_base64)?;
        save_recording(&directory, &name, extension, &data).map(|path| path.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recording_export_validates_container_and_never_overwrites() {
        let data = [0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let encoded = base64::engine::general_purpose::STANDARD.encode(data);
        assert_eq!(recording_data("audio/webm;codecs=opus", &encoded).unwrap().1, "webm");
        assert!(recording_data("audio/mp4", &encoded).is_err());
        assert!(recording_data("audio/webm", "broken").is_err());
        let directory = std::env::temp_dir().join(format!("aureon-recording-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let first = save_recording(&directory, "../CON:one", "webm", &data).unwrap();
        let second = save_recording(&directory, "../CON:one", "webm", b"second").unwrap();
        assert_eq!(first.parent(), Some(directory.as_path()));
        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), data);
        fs::remove_file(first).unwrap(); fs::remove_file(second).unwrap(); fs::remove_dir(directory).unwrap();
    }
}
