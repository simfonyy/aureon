use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, WebviewWindow};

const MINI_WIDTH: f64 = 396.0;
const MINI_HEIGHT: f64 = 152.0;

const MIN_WIDTH: f64 = 300.0;
const MAX_WIDTH: f64 = 720.0;
const MIN_HEIGHT: f64 = 120.0;
const MAX_HEIGHT: f64 = 420.0;

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn size_of(width: Option<f64>, height: Option<f64>) -> (f64, f64) {
    (
        clamp(width.unwrap_or(MINI_WIDTH), MIN_WIDTH, MAX_WIDTH),
        clamp(height.unwrap_or(MINI_HEIGHT), MIN_HEIGHT, MAX_HEIGHT),
    )
}

fn window_of(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Окно не найдено".to_string())
}

fn force_size(win: &WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    let locked = !win.is_resizable().unwrap_or(false);
    if locked {
        win.set_resizable(true).map_err(|e| e.to_string())?;
    }
    let result = win
        .set_size_constraints(Default::default())
        .and_then(|_| win.set_size(LogicalSize::new(width, height)));
    if locked {
        win.set_resizable(false).map_err(|e| e.to_string())?;
    }
    result.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn enter_mini_player(
    app: AppHandle,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let win = window_of(&app)?;
    let (width, height) = size_of(width, height);

    let _ = win.unmaximize();
    win.set_resizable(false).map_err(|e| e.to_string())?;
    force_size(&win, width, height)?;
    win.set_always_on_top(true).map_err(|e| e.to_string())?;

    if let Ok(Some(monitor)) = win.current_monitor() {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        let x = pos.x + size.width - width - 24.0;
        let y = pos.y + size.height - height - 72.0;
        let _ = win.set_position(LogicalPosition::new(x, y));
    }

    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
pub fn resize_mini_player(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    let win = window_of(&app)?;
    let (width, height) = size_of(Some(width), Some(height));
    force_size(&win, width, height)
}

fn undocked_x(x: i32, left: i32, last_x: i32, threshold: i32) -> i32 {
    let inset = (threshold + 1).min((last_x - left) / 2);
    x.clamp(left + inset, last_x - inset)
}

#[tauri::command]
pub fn dock_mini_player(
    app: AppHandle,
    expanded: bool,
    was_docked: bool,
    width: f64,
    height: f64,
) -> Result<Option<&'static str>, String> {
    let win = window_of(&app)?;
    if !win.is_always_on_top().map_err(|e| e.to_string())? {
        return Ok(None);
    }
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Экран мини-плеера недоступен".to_string())?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let left = area.position.x;
    let right = left + area.size.width as i32;
    let threshold = (16.0 * scale).round() as i32;
    let side = if (pos.x - left).abs() <= threshold {
        Some("left")
    } else if (right - pos.x - size.width as i32).abs() <= threshold {
        Some("right")
    } else {
        None
    };
    let inner = win.inner_size().map_err(|e| e.to_string())?;
    if side.is_none() && !was_docked && inner.to_logical::<f64>(scale).height >= MIN_HEIGHT - 1.0 {
        return Ok(None);
    }
    let (w, h) = if side.is_some() {
        (if expanded { 320.0 } else { 60.0 }, 60.0)
    } else {
        size_of(Some(width), Some(height))
    };
    let target = LogicalSize::new(w, h).to_physical::<u32>(scale);
    let last_x = (right - target.width as i32).max(left);
    let top = area.position.y;
    let last_y = (top + area.size.height as i32 - target.height as i32).max(top);
    let x = match side {
        Some("left") => left,
        Some("right") => last_x,
        _ => undocked_x(pos.x, left, last_x, threshold),
    };
    let destination = PhysicalPosition::new(x, pos.y.clamp(top, last_y));
    if target != inner {
        force_size(&win, w, h)?;
    }
    if destination != pos || target != inner {
        win.set_position(destination).map_err(|e| e.to_string())?;
    }
    Ok(side)
}

#[tauri::command]
pub fn exit_mini_player(app: AppHandle) -> Result<(), String> {
    let win = window_of(&app)?;

    win.set_always_on_top(false).map_err(|e| e.to_string())?;
    win.set_resizable(true).map_err(|e| e.to_string())?;
    win.set_max_size(None::<LogicalSize<f64>>)
        .map_err(|e| e.to_string())?;
    win.set_min_size(Some(LogicalSize::new(940.0, 600.0)))
        .map_err(|e| e.to_string())?;
    win.set_size(LogicalSize::new(1200.0, 800.0))
        .map_err(|e| e.to_string())?;
    let _ = win.center();
    let _ = win.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wider_player_stays_outside_the_snap_zone_after_detaching() {
        for scale in [1.0_f64, 1.25, 1.5, 2.0] {
            let threshold = (16.0 * scale).round() as i32;
            let left = -1920;
            let last_x = -(396.0 * scale).round() as i32;
            for x in [left - 50, left + 100, -100] {
                let restored = undocked_x(x, left, last_x, threshold);
                assert!(restored - left > threshold && last_x - restored > threshold);
            }
        }
        assert_eq!(undocked_x(300, 30, 30, 16), 30);
    }
}
