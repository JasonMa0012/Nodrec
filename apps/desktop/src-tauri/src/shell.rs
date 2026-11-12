use std::path::Path;

fn open_target(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::{core::{w, PCWSTR}, Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}};
        let target: Vec<u16> = target.encode_utf16().chain(Some(0)).collect();
        let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(target.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if result.0 as isize <= 32 { return Err(format!("Cannot open target (Windows error {})", result.0 as isize)); }
        Ok(())
    }
    #[cfg(not(windows))]
    { let _ = target; Err("Opening folders is currently supported on Windows only".into()) }
}

fn validate_folder(path: &str) -> Result<(), String> {
    if path.contains('\0') || !Path::new(path).is_absolute() { return Err("Choose an absolute folder path".into()); }
    if !Path::new(path).is_dir() { return Err(format!("Folder does not exist or is inaccessible: {path}")); }
    Ok(())
}

#[tauri::command]
pub fn open_folder(window: tauri::WebviewWindow, path: String) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can open folders".into()); }
    validate_folder(&path)?;
    open_target(&path)
}

#[tauri::command]
pub fn open_project(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main window can open the project".into()); }
    open_target("https://github.com/JasonMa0012/Nodrec")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_opening_accepts_only_existing_absolute_directories() {
        assert!(validate_folder(env!("CARGO_MANIFEST_DIR")).is_ok());
        for path in ["", "relative", "https://example.com", "C:\0hidden"] { assert!(validate_folder(path).is_err(), "{path}"); }
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(validate_folder(root.join("Cargo.toml").to_str().unwrap()).is_err());
        assert!(validate_folder(root.join("missing-folder-for-shell-test").to_str().unwrap()).is_err());
    }
}
