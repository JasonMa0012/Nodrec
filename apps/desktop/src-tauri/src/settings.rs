use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::{atomic::{AtomicBool, Ordering}, Mutex}, time::Duration};
use tauri::{Emitter, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const REPOSITORY: &str = "https://github.com/JasonMa0012/Nodrec";
const MANIFEST: &str = "https://github.com/JasonMa0012/Nodrec/releases/latest/download/latest.json";
const ACCELERATORS: [&str; 5] = [
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "https://ghproxy.vip/",
    "https://ghfile.geekertao.top/",
    "https://gh-proxy.org/",
];

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ProxyMode { Direct, #[default] System, Custom }

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub check_on_startup: bool,
    pub proxy_mode: ProxyMode,
    pub proxy_url: String,
}
impl Default for Settings {
    fn default() -> Self { Self { check_on_startup: true, proxy_mode: ProxyMode::System, proxy_url: "http://127.0.0.1:7890".into() } }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        if self.proxy_mode == ProxyMode::Custom {
            let url = reqwest::Url::parse(&self.proxy_url).map_err(|_| "Enter a proxy URL such as http://127.0.0.1:7890")?;
            if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h") || url.host_str().is_none() || url.port_or_known_default().is_none()
                || url.path() != "/" && !url.path().is_empty() || url.query().is_some() || url.fragment().is_some() {
                return Err("Proxy must be an HTTP(S) or SOCKS5 host and port, without a path".into());
            }
        }
        Ok(())
    }
    fn client(&self) -> Result<reqwest::Client, String> {
        self.validate()?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let mut builder = reqwest::Client::builder().user_agent("Nodrec updater").timeout(Duration::from_secs(4));
        match self.proxy_mode {
            ProxyMode::Direct => builder = builder.no_proxy(),
            ProxyMode::Custom => builder = builder.no_proxy().proxy(reqwest::Proxy::all(&self.proxy_url).map_err(|e| e.to_string())?),
            ProxyMode::System => {},
        }
        builder.build().map_err(|e| e.to_string())
    }
}

#[derive(Default)]
pub struct UpdateState { pending: Mutex<Option<Update>>, busy: AtomicBool }
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> { fn drop(&mut self) { self.0.store(false, Ordering::Release); } }
impl UpdateState {
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).map_err(|_| "An update operation is already running")?;
        Ok(Busy(&self.busy))
    }
}
fn main_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("Only the main window can manage updates".into()) }
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("settings.json"))
}
pub fn load(app: &tauri::AppHandle) -> Result<Settings, String> {
    match fs::read(settings_path(app)?) {
        Ok(bytes) => { let settings: Settings = serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read settings: {e}"))?; settings.validate()?; Ok(settings) },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(format!("Cannot read settings: {e}")),
    }
}
#[tauri::command]
pub fn get_settings(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Settings, String> { main_window(&window)?; load(&app) }
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, UpdateState>, settings: Settings) -> Result<(), String> {
    main_window(&window)?;
    let _busy = state.begin()?;
    settings.validate()?;
    let path = settings_path(&app)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    super::storage::atomic_write(&path, &serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?)?;
    *state.pending.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

// Geolocation follows the selected proxy, so routing reflects the actual public egress IP.
async fn mainland(settings: &Settings) -> Option<bool> {
    let client = settings.client().ok()?;
    for endpoint in ["https://ipwho.is/", "https://ipapi.co/json/"] {
        if let Ok(response) = client.get(endpoint).send().await {
            if let Ok(response) = response.error_for_status() {
                if let Ok(json) = response.json::<serde_json::Value>().await {
                    if let Some(code) = json["country_code"].as_str() { return Some(code == "CN"); }
                }
            }
        }
    }
    None
}
fn routes(china: Option<bool>) -> Vec<&'static str> {
    let mut routes = ACCELERATORS.to_vec();
    if china == Some(true) { routes.push(""); } else { routes.insert(0, ""); }
    routes
}
fn updater(app: &tauri::AppHandle, settings: &Settings, endpoint: String) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder().timeout(Duration::from_secs(25))
        .endpoints(vec![endpoint.parse().map_err(|_| "Invalid update endpoint")?]).map_err(|e| e.to_string())?;
    match settings.proxy_mode {
        ProxyMode::Direct => builder = builder.no_proxy(),
        ProxyMode::Custom => builder = builder.proxy(settings.proxy_url.parse().map_err(|_| "Invalid proxy URL")?),
        ProxyMode::System => {},
    }
    builder.build().map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo { current_version: String, version: Option<String>, notes: Option<String>, mainland: Option<bool>, route: String }

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, UpdateState>) -> Result<UpdateInfo, String> {
    main_window(&window)?;
    let _busy = state.begin()?;
    *state.pending.lock().map_err(|e| e.to_string())? = None;
    let settings = load(&app)?;
    super::log_startup("update: checking egress region");
    let china = mainland(&settings).await;
    super::log_startup(&format!("update: mainland={china:?}"));
    let mut errors = Vec::new();
    for prefix in routes(china) {
        super::log_startup(&format!("update: checking route={prefix}"));
        match updater(&app, &settings, format!("{prefix}{MANIFEST}"))?.check().await {
            Ok(update) => {
                if let Some(update) = &update {
                    if let Err(error) = validate_download(update.download_url.as_str()) {
                        super::log_startup(&format!("update: rejected route={prefix}: {error}"));
                        errors.push(format!("{prefix}: {error}"));
                        continue;
                    }
                }
                let result = UpdateInfo { current_version: app.package_info().version.to_string(), version: update.as_ref().map(|u| u.version.clone()), notes: update.as_ref().and_then(|u| u.body.clone()), mainland: china, route: if prefix.is_empty() { "GitHub".into() } else { prefix.into() } };
                *state.pending.lock().map_err(|e| e.to_string())? = update;
                return Ok(result);
            },
            Err(e) => { super::log_startup(&format!("update: check failed: {e}")); errors.push(format!("{}: {e}", if prefix.is_empty() { "GitHub" } else { prefix })); },
        }
    }
    Err(format!("Cannot check for updates. {}", errors.join("; ")))
}
fn validate_download(url: &str) -> Result<(), String> {
    if url.starts_with(&format!("{REPOSITORY}/releases/download/")) && url.ends_with("-setup.exe") { Ok(()) }
    else { Err("Release download must be a Nodrec GitHub installer".into()) }
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, UpdateState>, runtime: State<'_, super::AppState>) -> Result<(), String> {
    main_window(&window)?;
    let _busy = state.begin()?;
    if matches!(runtime.workflow.snapshot().status.as_str(), "starting" | "recording" | "paused" | "stopping") { return Err("Stop recording before updating".into()); }
    let mut update = state.pending.lock().map_err(|e| e.to_string())?.take().ok_or("Check for updates first")?;
    let settings = load(&app)?;
    super::log_startup("update: checking download egress region");
    runtime.workflow.tools.reset(&app);
    let china = mainland(&settings).await;
    let original = update.download_url.to_string();
    validate_download(&original)?;
    let mut errors = Vec::new();
    for prefix in routes(china) {
        super::log_startup(&format!("update: downloading route={prefix}"));
        update.download_url = format!("{prefix}{original}").parse().map_err(|_| "Invalid download URL")?;
        // Each route has its own progress; a failed transfer is retried from zero and verified again.
        update.timeout = Some(Duration::from_secs(180));
        let mut downloaded = 0_u64;
        match update.download(|chunk, total| {
            downloaded += chunk as u64;
            let _ = app.emit("update-progress", serde_json::json!({ "downloaded": downloaded, "total": total, "route": if prefix.is_empty() { "GitHub" } else { prefix } }));
        }, || {}).await {
            Ok(bytes) => {
                super::log_startup(&format!("update: verified {} bytes; installing {}", bytes.len(), update.version));
                runtime.workflow.tools.reset(&app);
                runtime.workflow.stop_for_shutdown();
                return update.install(bytes).map_err(|e| e.to_string());
            },
            Err(e) => errors.push(e.to_string()),
        }
    }
    update.download_url = original.parse().map_err(|_| "Invalid download URL")?;
    *state.pending.lock().map_err(|e| e.to_string())? = Some(update);
    Err(format!("Cannot download a verified update: {}", errors.join("; ")))
}

#[tauri::command]
pub fn open_project(window: tauri::WebviewWindow) -> Result<(), String> {
    main_window(&window)?;
    std::process::Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", REPOSITORY]).spawn().map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_proxy_validation() {
        let mut settings = Settings::default();
        assert!(settings.check_on_startup);
        assert_eq!(settings.proxy_mode, ProxyMode::System);
        assert!(settings.client().is_ok());
        settings.proxy_mode = ProxyMode::Custom;
        for url in ["http://127.0.0.1:7890", "socks5h://localhost:1080", "https://proxy.example:443"] { settings.proxy_url = url.into(); assert!(settings.validate().is_ok(), "{url}"); }
        for url in ["file:///etc/passwd", "127.0.0.1:7890", "http://localhost:99999", "http://localhost:80/path"] { settings.proxy_url = url.into(); assert!(settings.validate().is_err(), "{url}"); }
    }
    #[test]
    fn routing_and_download_boundary() {
        assert_eq!(routes(Some(true))[0], ACCELERATORS[0]);
        assert_eq!(routes(Some(false))[0], "");
        assert_eq!(routes(None)[0], "");
        for region in [Some(true), Some(false), None] {
            let routes = routes(region);
            assert_eq!(routes.len(), ACCELERATORS.len() + 1);
            assert_eq!(routes.iter().filter(|route| route.is_empty()).count(), 1);
            assert_eq!(routes.iter().copied().filter(|route| !route.is_empty()).collect::<Vec<_>>(), ACCELERATORS);
        }
        assert_eq!(routes(Some(true)).last(), Some(&""));
        assert!(validate_download("https://github.com/JasonMa0012/Nodrec/releases/download/v0.1.1/Nodrec_0.1.1_x64-setup.exe").is_ok());
        assert!(validate_download("https://github.com/attacker/Nodrec/releases/download/v1/evil-setup.exe").is_err());
        let state = UpdateState::default();
        let busy = state.begin().unwrap();
        assert!(state.begin().is_err());
        drop(busy);
        assert!(state.begin().is_ok());
    }
}
