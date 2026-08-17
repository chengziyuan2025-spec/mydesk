#[cfg(windows)]
use image::{imageops::FilterType, ImageReader};
#[cfg(windows)]
use std::path::PathBuf;

pub fn dominant_color() -> Option<String> {
    #[cfg(windows)]
    {
        let path = wallpaper_path()?;
        let image = ImageReader::open(path)
            .ok()?
            .with_guessed_format()
            .ok()?
            .decode()
            .ok()?;
        let rgb = image
            .resize_exact(1, 1, FilterType::Triangle)
            .to_rgb8()
            .get_pixel(0, 0)
            .0;
        Some(format_hex(rgb))
    }

    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn wallpaper_path() -> Option<PathBuf> {
    use windows::Win32::{
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
            COINIT_APARTMENTTHREADED,
        },
        UI::Shell::{DesktopWallpaper, IDesktopWallpaper},
    };

    // The command can run from any Tauri worker thread, so it owns COM initialization locally.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let path = unsafe {
        let desktop: IDesktopWallpaper =
            CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL).ok()?;
        let monitor_id = desktop.GetMonitorDevicePathAt(0).ok()?;
        let raw_path = desktop.GetWallpaper(monitor_id);
        CoTaskMemFree(Some(monitor_id.0.cast()));
        let raw_path = raw_path.ok()?;
        let result = raw_path.to_string().ok();
        CoTaskMemFree(Some(raw_path.0.cast()));
        result
    };
    if initialized {
        unsafe { CoUninitialize() };
    }
    path.map(PathBuf::from)
}

fn format_hex([red, green, blue]: [u8; 3]) -> String {
    format!("#{red:02x}{green:02x}{blue:02x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_lowercase_hex_colors() {
        assert_eq!(format_hex([0, 160, 255]), "#00a0ff");
    }
}
