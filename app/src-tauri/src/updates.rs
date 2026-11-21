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
    #[cfg(windows)]
    let name = if windows_update::installed_executable() {
        name
    } else {
        format!("Aureon_{}_windows-x64.exe", release.tag_name.trim_start_matches('v'))
    };
    release.assets.iter().find(|a| valid_asset(a, &release.tag_name, &name))
}

#[tauri::command]
pub async fn check_update() -> Result<Option<Update>, String> {
    let Some(release) = latest().await? else {
        return Ok(None);
    };
    let asset = selected_asset(&release);
    #[cfg(windows)]
    let asset = asset.filter(|package| !cfg!(debug_assertions) && signature_asset(&release, package).is_some());
    Ok(Some(Update {
        version: release.tag_name.trim_start_matches('v').into(),
        release_url: format!("{REPOSITORY}/releases/tag/{}", release.tag_name),
        package_name: asset.map(|a| a.name.clone()),
        can_install: cfg!(target_os = "windows") && asset.is_some(),
    }))
}

#[cfg(any(windows, test))]
fn signature_asset<'a>(release: &'a Release, package: &Asset) -> Option<&'a Asset> {
    let name = format!("{}.sig", package.name);
    release.assets.iter().find(|asset| asset.size == 64 && valid_asset(asset, &release.tag_name, &name))
}

#[cfg(any(windows, test))]
fn verify_signature(public_key: &[u8; 32], version: &str, asset: &Asset, signature: &[u8]) -> Result<(), String> {
    use ed25519_dalek::{Signature, VerifyingKey};
    let error = || "Не удалось подтвердить подпись обновления Aureon.".to_string();
    let hash = checksum(asset).ok_or_else(error)?.to_ascii_lowercase();
    let message = format!("aureon-update-v1\n{version}\n{}\n{}\n{hash}\n", asset.name, asset.size);
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| error())?;
    let sig = Signature::from_slice(signature).map_err(|_| error())?;
    key.verify_strict(message.as_bytes(), &sig).map_err(|_| error())
}

#[cfg(windows)]
async fn authenticate(release: &Release, package: &Asset) -> Result<(), String> {
    let asset = signature_asset(release, package).ok_or("В релизе нет подписи для этого файла.")?;
    let mut response = client(30)?.get(&asset.browser_download_url).send().await
        .and_then(|r| r.error_for_status()).map_err(|_| "Не удалось скачать подпись обновления.")?;
    let mut bytes = Vec::with_capacity(64);
    while let Some(chunk) = response.chunk().await.map_err(|_| "Загрузка подписи прервалась.")? {
        if bytes.len() + chunk.len() > 64 { return Err("Неверная длина подписи.".into()); }
        bytes.extend_from_slice(&chunk);
    }
    let key: [u8; 32] = hex::decode(include_str!("../update-public-key.hex").trim())
        .ok().and_then(|v| v.try_into().ok()).ok_or("Ошибка ключа обновлений.")?;
    verify_signature(&key, release.tag_name.trim_start_matches('v'), package, &bytes)
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
    #[cfg(windows)]
    {
        if cfg!(debug_assertions) { return Err("Автообновление доступно в релизной сборке.".into()); }
        authenticate(&release, asset).await?;
    }
    let folder = if cfg!(target_os = "windows") {
        app.path().app_cache_dir()
    } else {
        app.path().download_dir()
    }
    .map_err(|_| "Не удалось найти папку для обновления.")?
    .join("Aureon-updates");
    std::fs::create_dir_all(&folder).map_err(|_| "Не удалось создать папку для обновления.")?;
    let target = folder.join(&asset.name);

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
        let mut file = tempfile::NamedTempFile::new_in(&folder).map_err(|_| "Не удалось сохранить обновление.")?;
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
        file.as_file().sync_all()
            .map_err(|_| "Не удалось сохранить обновление.")?;
        file.persist(&target).map_err(|_| "Не удалось сохранить пакет.")?;
        Ok(())
    }
    .await;
    result?;
    #[cfg(windows)]
    windows_update::prepare(requested_version, target.clone(), checksum(asset).unwrap().to_ascii_lowercase());
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&folder).spawn();
    }
    Ok(target.to_string_lossy().into_owned())
}

#[cfg(windows)]
mod windows_update {
    use super::*;
    use std::{ffi::OsString, fs::OpenOptions, os::windows::{ffi::OsStringExt, fs::OpenOptionsExt}, path::{Path, PathBuf}, sync::Mutex};
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    struct Package { version: String, path: PathBuf, digest: String }
    static PREPARED: Mutex<Option<Package>> = Mutex::new(None);

    pub(super) fn installed_executable() -> bool {
        let path: Option<String> = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Nightlezz\MusicMSI").and_then(|key| key.get_value("Executable")).ok();
        path.zip(std::env::current_exe().ok()).is_some_and(|(installed, current)|
            same_file::is_same_file(installed, current).unwrap_or(false))
    }

    pub(super) fn prepare(version: String, path: PathBuf, digest: String) {
        *PREPARED.lock().unwrap() = Some(Package { version, path, digest });
    }

    fn start_installer(path: &Path) -> Result<(), String> {
        let mut buf = [0u16; 1024];
        let n = unsafe { windows::Win32::System::SystemInformation::GetSystemDirectoryW(Some(&mut buf)) } as usize;
        if n == 0 || n >= buf.len() { return Err("Не удалось найти Windows Installer.".into()); }
        let system = PathBuf::from(OsString::from_wide(&buf[..n]));
        std::process::Command::new(system.join("msiexec.exe"))
            .arg("/i").arg(path).args(["/passive", "/norestart", "AUTOLAUNCHAPP=1"])
            .spawn().map_err(|_| "Не удалось запустить Windows Installer.")?;
        Ok(())
    }

    pub(super) fn install(app: tauri::AppHandle, version: &str) -> Result<(), String> {
        let package = PREPARED.lock().unwrap().take().filter(|p| p.version == version)
            .ok_or("Сначала скачайте и проверьте обновление.")?;
        let mut file = OpenOptions::new().read(true).share_mode(1).open(&package.path)
            .map_err(|_| "Не удалось открыть сохранённое обновление.")?;
        let mut hash = Sha256::new();
        std::io::copy(&mut file, &mut hash).map_err(|_| "Не удалось проверить сохранённый файл.")?;
        if hex::encode(hash.finalize()) != package.digest {
            return Err("Скачанный пакет изменился. Загрузите его заново.".into());
        }
        if package.path.extension().is_some_and(|ext| ext == "msi") {
            if !installed_executable() { return Err("Не найдена установленная копия Aureon.".into()); }
            start_installer(&package.path)?;
            app.exit(0);
        } else {
            if installed_executable() { return Err("Для этой копии нужен установщик MSI.".into()); }
            self_replace::self_replace(&package.path).map_err(|_| "Не удалось обновить Aureon в этой папке. Проверьте права на запись.")?;
            drop(file);
            let _ = std::fs::remove_file(&package.path);
            app.request_restart();
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, requested_version: String) -> Result<(), String> {
    #[cfg(windows)]
    return windows_update::install(app, &requested_version);
    #[cfg(not(windows))]
    { let _ = (app, requested_version); Err("Пакет можно установить из папки загрузок.".into()) }
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
    #[cfg(windows)]
    #[test]
    fn portable_replaces_a_disposable_copy_in_place() {
        use std::{fs, process::Command};
        const WORKER: &str = "AUREON_PORTABLE_TEST_DIR";
        let exe = std::env::current_exe().unwrap();
        if let Some(dir) = std::env::var_os(WORKER) {
            let dir = std::path::PathBuf::from(dir);
            assert_eq!(exe, dir.join("Aureon.exe"));
            self_replace::self_replace(dir.join("next.exe")).unwrap();
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let portable = dir.path().join("Aureon.exe");
        fs::copy(&exe, &portable).unwrap();
        let next = dir.path().join("next.exe");
        fs::copy(&exe, &next).unwrap();
        fs::OpenOptions::new().append(true).open(&next).unwrap().write_all(b"update test").unwrap();
        let status = Command::new(&portable)
            .args(["--exact", "updates::tests::portable_replaces_a_disposable_copy_in_place"])
            .env(WORKER, dir.path()).status().unwrap();
        assert!(status.success());
        assert_eq!(fs::metadata(portable).unwrap().len(), fs::metadata(next).unwrap().len());
    }

    #[test]
    fn update_signature_binds_the_version_name_size_and_hash() {
        use ed25519_dalek::{Signer, SigningKey};
        let name = "Aureon_1.2.2_windows-x64.exe";
        let hash = "ab".repeat(32);
        let mut asset = Asset {
            name: name.into(), size: 42, digest: Some(format!("sha256:{hash}")),
            browser_download_url: String::new(), state: "uploaded".into(),
        };
        let key = SigningKey::from_bytes(&[9; 32]);
        let sig = key.sign(format!("aureon-update-v1\n1.2.2\n{name}\n42\n{hash}\n").as_bytes()).to_bytes();
        let verify = |v, a: &Asset| verify_signature(key.verifying_key().as_bytes(), v, a, &sig);
        assert!(verify("1.2.2", &asset).is_ok());
        assert!(verify("1.2.3", &asset).is_err());
        asset.name.push('x');
        assert!(verify("1.2.2", &asset).is_err());
        asset.name = name.into();
        asset.size += 1;
        assert!(verify("1.2.2", &asset).is_err());
        asset.size = 42;
        asset.digest = Some(format!("sha256:{}", "bc".repeat(32)));
        assert!(verify("1.2.2", &asset).is_err());
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
