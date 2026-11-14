use serde::Serialize;
use std::{fs::{File, OpenOptions}, io::Write, path::PathBuf, sync::{Arc, Mutex, OnceLock}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub level: String,
    pub source: String,
    pub blueprint_id: Option<String>,
    pub run_id: Option<String>,
    pub message: String,
}

struct LogStore {
    entries: Vec<LogEntry>,
    path: PathBuf,
    file: Option<File>,
    on_entry: Option<Arc<dyn Fn(&LogEntry) + Send + Sync>>,
}

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

impl LogStore {
    fn new(path: PathBuf) -> Self {
        let result = std::fs::create_dir_all(path.parent().unwrap())
            .and_then(|_| OpenOptions::new().create_new(true).write(true).open(&path));
        let mut store = Self { entries: vec![], path, file: None, on_entry: None };
        match result {
            Ok(file) => store.file = Some(file),
            Err(error) => { store.push("error", "logging", None, None, format!("Cannot create log file {}: {error}", store.path.display())); }
        }
        store
    }

    fn push(&mut self, level: &str, source: &str, blueprint_id: Option<String>, run_id: Option<String>, message: String) -> LogEntry {
        let entry = LogEntry { sequence: self.entries.len() as u64 + 1, timestamp_ms: now_ms(), level: level.into(), source: source.into(), blueprint_id, run_id, message };
        self.entries.push(entry.clone());
        entry
    }

    fn write(&mut self, level: &str, source: &str, blueprint_id: Option<String>, run_id: Option<String>, message: String) -> Vec<LogEntry> {
        let entry = self.push(level, source, blueprint_id, run_id, message);
        let line = format!("[unix_ms={}] [{}] [{}] blueprint={:?} run={:?} {}", entry.timestamp_ms, entry.level, entry.source, entry.blueprint_id, entry.run_id, entry.message);
        #[cfg(not(test))]
        let _ = writeln!(std::io::stderr().lock(), "{line}");
        let mut added = vec![entry];
        if let Some(file) = &mut self.file {
            if let Err(error) = writeln!(file, "{line}").and_then(|_| file.flush()) {
                self.file = None;
                let error = self.push("error", "logging", None, None, format!("Cannot write log file {}: {error}", self.path.display()));
                #[cfg(not(test))]
                let _ = writeln!(std::io::stderr().lock(), "{}", error.message);
                added.push(error);
            }
        }
        added
    }
}

fn store() -> &'static Mutex<LogStore> {
    static STORE: OnceLock<Mutex<LogStore>> = OnceLock::new();
    STORE.get_or_init(|| {
        let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        Mutex::new(LogStore::new(root.join("Nodrec").join("logs").join(format!("nodrec-{}-{}.log", now_ms(), std::process::id()))))
    })
}

pub fn attach(app: AppHandle) {
    store().lock().unwrap_or_else(|e| e.into_inner()).on_entry = Some(Arc::new(move |entry| { let _ = app.emit("app-log", entry); }));
}

pub fn write(level: &str, source: &str, message: impl Into<String>) {
    contextual(level, source, None, None, message.into());
}

pub fn contextual(level: &str, source: &str, blueprint_id: Option<String>, run_id: Option<String>, message: String) -> LogEntry {
    let mut store = store().lock().unwrap_or_else(|e| e.into_inner());
    let entries = store.write(level, source, blueprint_id, run_id, message);
    let on_entry = store.on_entry.clone();
    drop(store);
    if let Some(on_entry) = on_entry { for entry in &entries { on_entry(entry); } }
    entries[0].clone()
}

pub fn entries() -> Vec<LogEntry> { store().lock().unwrap_or_else(|e| e.into_inner()).entries.clone() }

#[tauri::command]
pub fn get_logs(window: tauri::WebviewWindow) -> Result<Vec<LogEntry>, String> {
    if window.label() != "main" { return Err("Only the main window can read application logs".into()); }
    Ok(entries())
}

#[tauri::command]
pub fn open_logs_folder(window: tauri::WebviewWindow) -> Result<(), String> {
    let path = store().lock().unwrap_or_else(|e| e.into_inner()).path.parent().unwrap().to_string_lossy().into_owned();
    crate::shell::open_folder(window, path)
}

#[tauri::command]
pub fn app_log(window: tauri::WebviewWindow, level: String, message: String) -> Result<(), String> {
    if !matches!(level.as_str(), "debug" | "info" | "warn" | "error") { return Err("Invalid log level".into()); }
    write(&level, window.label(), message);
    Ok(())
}

pub fn startup_system_info() {
    write("info", "system", format!("Nodrec {} | {} {} | logical CPUs={}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH, std::thread::available_parallelism().map(|v| v.get()).unwrap_or(0)));
    let path = store().lock().unwrap_or_else(|e| e.into_inner()).path.clone();
    write("info", "system", format!("Log file: {}", path.display()));
    #[cfg(windows)] windows_system_info();
    match crate::recording::displays() {
        Ok(displays) => for display in displays { write("info", "system", format!("Display: {} | {}x{} at {},{} | HDR={}", display.name, display.width, display.height, display.x, display.y, display.hdr)); },
        Err(error) => write("error", "system", format!("Display enumeration failed: {error}")),
    }
}

#[cfg(windows)]
fn registry_string(key: &str, name: &str) -> String {
    use windows::{core::PCWSTR, Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ}};
    let key: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let mut size = 0;
    unsafe {
        let result = (|| -> windows::core::Result<String> {
            RegGetValueW(HKEY_LOCAL_MACHINE, PCWSTR(key.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, None, Some(&mut size)).ok()?;
            let mut buffer = vec![0u16; (size as usize + 1) / 2];
            RegGetValueW(HKEY_LOCAL_MACHINE, PCWSTR(key.as_ptr()), PCWSTR(name.as_ptr()), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)).ok()?;
            Ok(String::from_utf16_lossy(&buffer).trim_end_matches('\0').trim().into())
        })();
        result.unwrap_or_else(|error| format!("Unavailable ({error})"))
    }
}

#[cfg(windows)]
fn windows_system_info() {
    use windows::{core::Interface, Win32::{Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIDevice, DXGI_ERROR_NOT_FOUND}, System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX}}};
    let key = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
    write("info", "system", format!("Windows: version={} | build={} | registry ProductName={}", registry_string(key, "DisplayVersion"), registry_string(key, "CurrentBuildNumber"), registry_string(key, "ProductName")));
    write("info", "system", format!("CPU: {}", registry_string("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0", "ProcessorNameString")));
    unsafe {
        let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        match GlobalMemoryStatusEx(&mut memory) {
            Ok(()) => write("info", "system", format!("RAM: total={} MiB | available={} MiB", memory.ullTotalPhys / 1048576, memory.ullAvailPhys / 1048576)),
            Err(error) => write("warn", "system", format!("RAM query failed: {error}")),
        }
        let result = (|| -> windows::core::Result<()> {
            let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
            let mut index = 0;
            loop {
                let adapter = match factory.EnumAdapters1(index) { Ok(adapter) => adapter, Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break, Err(error) => return Err(error) };
                let desc = adapter.GetDesc1()?;
                let name = String::from_utf16_lossy(&desc.Description).trim_end_matches('\0').to_string();
                let driver = adapter.CheckInterfaceSupport(&IDXGIDevice::IID).map(|v| format!("{}.{}.{}.{}", (v >> 48) & 65535, (v >> 32) & 65535, (v >> 16) & 65535, v & 65535)).unwrap_or_else(|error| format!("Unavailable ({error})"));
                write("info", "system", format!("GPU {index}: {name} | vendor=0x{:04X} device=0x{:04X} | VRAM={} MiB | shared={} MiB | driver={driver}", desc.VendorId, desc.DeviceId, desc.DedicatedVideoMemory / 1048576, desc.SharedSystemMemory / 1048576));
                index += 1;
            }
            Ok(())
        })();
        if let Err(error) = result { write("error", "system", format!("GPU enumeration failed: {error}")); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_keep_all_entries_and_write_context_to_disk() {
        let path = std::env::temp_dir().join(format!("nodrec-log-test-{}-{}.log", std::process::id(), now_ms()));
        let mut store = LogStore::new(path.clone());
        for n in 0..350 { store.write("info", "test", Some("blueprint".into()), Some("run".into()), format!("entry {n}\n第二行")); }
        assert_eq!(store.entries.len(), 350);
        assert_eq!(store.entries[349].sequence, 350);
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("[info] [test] blueprint=Some(\"blueprint\") run=Some(\"run\") entry 0\n第二行"));
        assert!(text.contains("entry 349"));
        drop(store);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn unavailable_file_is_reported_without_losing_memory_logs() {
        let mut store = LogStore::new(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml/log.txt"));
        assert_eq!(store.entries[0].level, "error");
        store.write("warn", "test", None, None, "still visible".into());
        assert_eq!(store.entries[1].message, "still visible");
    }
}
