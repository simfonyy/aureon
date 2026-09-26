use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    model: String,
    vendor: String,
    vram_mb: u64,
    display_attached: bool,
}

#[tauri::command]
pub async fn detect_gpu() -> Result<Vec<Adapter>, String> {
    tauri::async_runtime::spawn_blocking(enumerate)
        .await
        .map_err(|_| "GPU detection unavailable".to_string())?
}

#[cfg(windows)]
fn enumerate() -> Result<Vec<Adapter>, String> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1().map_err(|_| "DXGI unavailable")?;
        let mut adapters = Vec::new();
        for index in 0..16 {
            let Ok(adapter) = factory.EnumAdapters1(index) else { break };
            let Ok(desc) = adapter.GetDesc1() else { continue };
            if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 { continue }
            let end = desc.Description.iter().position(|v| *v == 0).unwrap_or(desc.Description.len());
            adapters.push(Adapter {
                model: String::from_utf16_lossy(&desc.Description[..end]),
                vendor: match desc.VendorId { 0x10de => "NVIDIA", 0x1002 => "AMD", 0x8086 => "Intel", _ => "Unknown" }.into(),
                vram_mb: desc.DedicatedVideoMemory as u64 / 1024 / 1024,
                display_attached: adapter.EnumOutputs(0).is_ok(),
            });
        }
        Ok(adapters)
    }
}
#[cfg(not(windows))]
fn enumerate() -> Result<Vec<Adapter>, String> { Ok(Vec::new()) }
