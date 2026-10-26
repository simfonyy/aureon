use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{Emitter, Manager};

const REPOSITORY: &str = "https://github.com/simfonyy/aureon";
const MAX_PACKAGE: u64 = 300 * 1024 * 1024;
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    version: String,
    release_url: String,
    package_name: Option<String>,
    can_install: bool,
}

fn version(raw: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = raw.strip_prefix('v').unwrap_or(raw).split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut result = [0; 3];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        result[i] = part.parse().ok()?;
    }
    Some(result)
}

fn client(timeout: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("Aureon/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(timeout))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            let trusted = matches!(
                url.host_str(),
                Some(
                    "github.com"
                        | "api.github.com"
                        | "release-assets.githubusercontent.com"
                        | "objects.githubusercontent.com"
                )
            );
            if attempt.previous().len() < 5 && url.scheme() == "https" && trusted {
                attempt.follow()
            } else {
                attempt.error("Unexpected download redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

async fn latest() -> Result<Option<Release>, String> {
    let response = client(25)?
        .get("https://api.github.com/repos/simfonyy/aureon/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| "Не удалось связаться с GitHub. Проверьте подключение.")?;
    if response.status() == 404 {
        return Ok(None);
    }
    if response.status() == 403 || response.status() == 429 {
        return Err("GitHub временно ограничил запросы. Попробуйте позже.".into());
    }
    let release: Release = response
        .error_for_status()
        .map_err(|_| "GitHub не ответил на проверку обновлений.")?
        .json()
        .await
        .map_err(|_| "Не удалось прочитать сведения о релизе.")?;
    if release.draft || release.prerelease {
        return Ok(None);
    }
    let Some(next) = version(&release.tag_name) else {
        return Ok(None);
    };
    if next <= version(env!("CARGO_PKG_VERSION")).unwrap() {
        return Ok(None);
    }
    Ok(Some(release))
}

fn package_name(tag: &str, os: &str, arch: &str, appimage: bool) -> Option<String> {
    version(tag)?;
    if arch != "x86_64" {
        return None;
    }
    let v = tag.strip_prefix('v').unwrap_or(tag);
    match os {
        "windows" => Some(format!("Aureon_{v}_x64_ru-RU.msi")),
        "linux" => Some(format!(
            "Aureon_{v}_amd64.{}",
            if appimage { "AppImage" } else { "deb" }
        )),
        _ => None,
    }
}

fn checksum(asset: &Asset) -> Option<&str> {
    let hash = asset.digest.as_deref()?.strip_prefix("sha256:")?;
    (hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hash)
}

fn valid_asset(asset: &Asset, tag: &str, name: &str) -> bool {
    asset.name == name
        && asset.state == "uploaded"
        && asset.size > 0
        && asset.size <= MAX_PACKAGE
        && checksum(asset).is_some()
        && asset.browser_download_url == format!("{REPOSITORY}/releases/download/{tag}/{name}")
}

fn selected_asset(release: &Release) -> Option<&Asset> {
    let name = package_name(
        &release.tag_name,
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::var_os("APPIMAGE").is_some(),
    )?;
    release
        .assets
        .iter()
        .find(|a| valid_asset(a, &release.tag_name, &name))
}

#[tauri::command]
pub async fn check_update() -> Result<Option<Update>, String> {
    let Some(release) = latest().await? else {
        return Ok(None);
    };
    let asset = selected_asset(&release);
    Ok(Some(Update {
        version: release.tag_name.trim_start_matches('v').into(),
        release_url: format!("{REPOSITORY}/releases/tag/{}", release.tag_name),
        package_name: asset.map(|a| a.name.clone()),
        can_install: cfg!(target_os = "windows") && asset.is_some(),
    }))
}

struct DownloadGuard;
impl Drop for DownloadGuard {
    fn drop(&mut self) {
        DOWNLOADING.store(false, Ordering::Release);
    }
}

// The renderer supplies a version only. URLs, file names and hashes always come from this repository.
#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    requested_version: String,
) -> Result<String, String> {
    if DOWNLOADING.swap(true, Ordering::AcqRel) {
        return Err("Обновление уже скачивается.".into());
    }
    let _guard = DownloadGuard;
    let release = latest()
        .await?
        .ok_or("Обновление больше недоступно. Проверьте ещё раз.")?;
    if version(&requested_version) != version(&release.tag_name) {
        return Err("Вышла другая версия. Проверьте обновления ещё раз.".into());
    }
    let asset = selected_asset(&release).ok_or("Пакет для этой системы пока не опубликован.")?;
    let folder = if cfg!(target_os = "windows") {
        app.path().app_cache_dir()
    } else {
        app.path().download_dir()
    }
    .map_err(|_| "Не удалось найти папку для обновления.")?
    .join("Aureon-updates");
    std::fs::create_dir_all(&folder).map_err(|_| "Не удалось создать папку для обновления.")?;
    let target = folder.join(&asset.name);
    let partial = folder.join(format!("{}.part", asset.name));
    let result: Result<(), String> = async {
        let mut response = client(600)?
            .get(&asset.browser_download_url)
            .send()
            .await
            .map_err(|_| "Не удалось скачать обновление.")?
            .error_for_status()
            .map_err(|_| "Пакет обновления недоступен.")?;
        if response.content_length().is_some_and(|n| n != asset.size) {
            return Err("Размер пакета не совпадает с данными GitHub.".into());
        }
        let mut file =
            std::fs::File::create(&partial).map_err(|_| "Не удалось сохранить обновление.")?;
        let mut hash = Sha256::new();
        let mut received = 0u64;
        let mut last_percent = 101;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Загрузка прервалась. Попробуйте ещё раз.")?
        {
            received += chunk.len() as u64;
            if received > asset.size {
                return Err("Неверный размер пакета.".into());
            }
            file.write_all(&chunk)
                .map_err(|_| "Не удалось записать обновление. Проверьте свободное место.")?;
            hash.update(&chunk);
            let percent = (received * 100 / asset.size) as u8;
            if percent != last_percent {
                let _ = app.emit("update-progress", percent);
                last_percent = percent;
            }
        }
        if received != asset.size
            || hex::encode(hash.finalize()) != checksum(asset).unwrap().to_ascii_lowercase()
        {
            return Err("Проверка файла не пройдена. Скачайте обновление заново.".into());
        }
        file.sync_all()
            .map_err(|_| "Не удалось сохранить обновление.")?;
        drop(file);
        if target.exists() {
            std::fs::remove_file(&target)
                .map_err(|_| "Не удалось заменить ранее скачанный пакет.")?;
        }
        std::fs::rename(&partial, &target).map_err(|_| "Не удалось сохранить пакет.")?;
        Ok(())
    }
    .await;
    if result.is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    result?;
    #[cfg(target_os = "windows")]
    {
        // Use the OS installer, with its normal confirmation screens and existing upgrade code.
        std::process::Command::new("msiexec.exe")
            .arg("/i")
            .arg(&target)
            .spawn()
            .map_err(|_| "Не удалось открыть установщик. Попробуйте ещё раз.")?;
        app.exit(0);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&folder).spawn();
    }
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stable_versions_compare_numerically() {
        assert!(version("v1.0.10") > version("1.0.2"));
        for bad in [
            "1.2",
            "1.2.3-beta",
            "01.2.3",
            "1.2.3/evil",
            "999999999999999999999999.0.0",
        ] {
            assert_eq!(version(bad), None);
        }
    }
    #[test]
    fn platform_packages_and_trust_boundary() {
        assert_eq!(
            package_name("v1.0.2", "windows", "x86_64", false).unwrap(),
            "Aureon_1.0.2_x64_ru-RU.msi"
        );
        assert!(package_name("1.0.2", "linux", "aarch64", false).is_none());
        assert!(package_name("1.0.2", "linux", "x86_64", true)
            .unwrap()
            .ends_with(".AppImage"));
        let name = "Aureon_1.0.2_x64_ru-RU.msi";
        let mut asset = Asset {
            name: name.into(),
            browser_download_url: format!("{REPOSITORY}/releases/download/v1.0.2/{name}"),
            size: 42,
            digest: Some(format!("sha256:{}", "a".repeat(64))),
            state: "uploaded".into(),
        };
        assert!(valid_asset(&asset, "v1.0.2", name));
        asset.browser_download_url = format!("https://evil.test/{name}");
        assert!(!valid_asset(&asset, "v1.0.2", name));
        asset.browser_download_url = format!("{REPOSITORY}/releases/download/v1.0.2/{name}");
        asset.digest = None;
        assert!(!valid_asset(&asset, "v1.0.2", name));
    }
}
