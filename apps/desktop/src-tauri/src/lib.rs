mod storage;
mod workflow;
pub mod recording;
mod region_tool;

use serde_json::Value;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager, State};

fn log_startup(stage: &str) {
    use std::{io::Write, sync::OnceLock, time::{Instant, SystemTime, UNIX_EPOCH}};
    static START: OnceLock<Instant> = OnceLock::new();
    let elapsed = START.get_or_init(Instant::now).elapsed().as_millis();
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    let line = format!("[startup] unix_ms={timestamp} pid={} +{elapsed}ms {}", std::process::id(), stage.replace(['\r', '\n'], " "));
    eprintln!("{line}");
    let path = std::env::temp_dir().join(format!("nodrec-startup-{}.log", std::process::id()));
    match std::fs::OpenOptions::new().create(true).append(true).open(path).and_then(|mut file| writeln!(file, "{line}")) {
        Ok(()) => {},
        Err(error) => eprintln!("[startup] Cannot write startup log: {error}"),
    }
}

#[tauri::command]
fn startup_log(window: tauri::WebviewWindow, stage: String) {
    log_startup(&format!("{} {}", window.label(), stage.chars().take(2048).collect::<String>()));
}

struct AppState {
    store: storage::BlueprintStore,
    workflow: workflow::WorkflowRuntime,
    store_lock: Mutex<()>,
    shutting_down: AtomicBool,
}

#[tauri::command]
fn list_blueprints(state: State<'_, AppState>) -> storage::BlueprintIndex {
    state.store.list()
}

#[tauri::command]
fn save_blueprint(
    state: State<'_, AppState>,
    scope: storage::BlueprintScope,
    id: String,
    document: Value,
    expected_revision: Option<String>,
) -> Result<String, String> {
    let _guard = state.store_lock.lock().map_err(|_| "Blueprint storage is unavailable".to_string())?;
    state.store.save(scope, &id, document, expected_revision)
}

#[tauri::command]
fn delete_blueprint(state: State<'_, AppState>, scope: storage::BlueprintScope, id: String) -> Result<String, String> {
    let snapshot = state.workflow.snapshot();
    if snapshot.blueprint_id.as_deref() == Some(&id) && matches!(snapshot.status.as_str(), "starting" | "recording" | "paused" | "stopping") {
        return Err("Stop the active workflow before deleting its blueprint".into());
    }
    let _guard = state.store_lock.lock().map_err(|_| "Blueprint storage is unavailable".to_string())?;
    state.store.delete(scope, &id)
}

#[tauri::command]
fn restore_blueprint(state: State<'_, AppState>, scope: storage::BlueprintScope, id: String, trash_name: String) -> Result<(), String> {
    let _guard = state.store_lock.lock().map_err(|_| "Blueprint storage is unavailable".to_string())?;
    state.store.restore(scope, &id, &trash_name)
}

#[tauri::command]
fn list_node_types() -> Vec<workflow::NodeType> {
    workflow::node_catalog()
}

#[tauri::command]
fn list_displays() -> Result<Vec<recording::DisplayInfo>, String> { recording::displays() }

#[tauri::command]
async fn activate_blueprint(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, document: Value) -> Result<workflow::Activation, String> {
    if window.label() != "main" { return Err("Only the main window can activate blueprints".into()); }
    let before = state.workflow.snapshot();
    let previous_tools = state.workflow.tool_definitions();
    let result = state.workflow.activate(document)?;
    if before.blueprint_id != state.workflow.snapshot().blueprint_id || previous_tools != state.workflow.tool_definitions()
        || state.workflow.tools.snapshot().is_some_and(|t| t.picking) { state.workflow.tools.reset(&app); }
    let _ = app.emit("workflow-status", state.workflow.snapshot());
    Ok(result)
}

#[tauri::command]
fn dispatch_blueprint_event(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, event_id: String) -> Result<workflow::RuntimeSnapshot, String> {
    if window.label() != "main" { return Err("Use the region tool session to dispatch controls".into()); }
    state.workflow.dispatch(app, event_id)
}

#[tauri::command]
fn region_tool_state(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    state.workflow.tools.validate_display(&app)?;
    Ok(serde_json::json!({"tool":state.workflow.tools.snapshot(),"runtime":state.workflow.snapshot()}))
}

fn check_tool(window: &tauri::WebviewWindow, state: &AppState, token: &str) -> Result<region_tool::Tool, String> {
    if !matches!(window.label(), "main" | "region-frame" | "region-toolbar") { return Err("Invalid region tool window".into()); }
    let snapshot = state.workflow.snapshot();
    state.workflow.tools.check(token, snapshot.blueprint_id.as_deref().unwrap_or_default())
}

#[tauri::command]
async fn region_tool_action(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, token: String, action: String, rect: Option<region_tool::Rect>) -> Result<(), String> {
    let tool = check_tool(&window, &state, &token)?;
    if action == "ready" { state.workflow.tools.ready(window.label()); }
    let locked = matches!(state.workflow.snapshot().status.as_str(), "starting" | "recording" | "paused" | "stopping");
    state.workflow.tools.update(&app, &token, &tool.blueprint_id, &action, rect, locked)?;
    if action == "reselect" || (action == "ready" && window.label() == "region-frame" && tool.picking) {
        if let Some(frame) = app.get_webview_window("region-frame") { frame.set_focus().map_err(|e| e.to_string())?; }
    }
    state.workflow.tools.enforce_capture_exclusion(&app, locked);
    Ok(())
}

#[tauri::command]
async fn region_tool_ratio(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, token: String, ratio: f64) -> Result<(), String> {
    let tool = check_tool(&window, &state, &token)?;
    state.workflow.tools.set_ratio(&app, &token, &tool.blueprint_id, ratio, matches!(state.workflow.snapshot().status.as_str(), "starting" | "recording" | "paused" | "stopping"))
}

#[tauri::command]
async fn region_tool_shape(window: tauri::WebviewWindow, state: State<'_, AppState>, token: String, areas: Vec<region_tool::Rect>) -> Result<(), String> {
    check_tool(&window, &state, &token)?;
    if window.label() != "region-toolbar" { return Err("Only the toolbar can set its shape".into()); }
    region_tool::set_toolbar_shape(&window, areas)
}

#[tauri::command]
async fn region_tool_layout(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, token: String, x: i32, y: i32, width: u32, height: u32) -> Result<(), String> {
    let tool = check_tool(&window, &state, &token)?;
    if window.label() != "region-toolbar" { return Err("Only the toolbar can set its layout".into()); }
    let width = width.clamp(1, tool.work.width);
    let height = height.clamp(1, tool.work.height);
    let x = x.clamp(tool.work.x, tool.work.x + tool.work.width as i32 - width as i32);
    let y = y.clamp(tool.work.y, tool.work.y + tool.work.height as i32 - height as i32);
    let toolbar = app.get_webview_window("region-toolbar").ok_or("Toolbar was closed")?;
    if toolbar.inner_size().map_err(|e| e.to_string())? != tauri::PhysicalSize::new(width, height) { toolbar.set_size(tauri::PhysicalSize::new(width, height)).map_err(|e| e.to_string())?; }
    let position = tauri::PhysicalPosition::new(tool.display.x+x, tool.display.y+y);
    if toolbar.outer_position().map_err(|e| e.to_string())? != position { toolbar.set_position(position).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn region_tool_dispatch(app: tauri::AppHandle, window: tauri::WebviewWindow, state: State<'_, AppState>, token: String, control_id: String, event_id: String) -> Result<workflow::RuntimeSnapshot, String> {
    let tool = check_tool(&window, &state, &token)?;
    let snapshot = state.workflow.snapshot();
    fn has_menu(items: &Value, event: &str) -> bool {
        items.as_array().is_some_and(|items| items.iter().any(|item| item["eventId"] == event || has_menu(&item["children"], event)))
    }
    let target = format!("region:{}", tool.tool_id);
    let valid = snapshot.controls.iter().any(|c| c["id"] == control_id && c["enabled"] != false
        && c["targets"].as_array().is_some_and(|targets| targets.iter().any(|t| t == &target))
        && (c["eventId"] == event_id || has_menu(&c["menu"], &event_id)));
    if !valid { return Err("Control is disabled or not registered for this tool".into()); }
    state.workflow.dispatch(app, event_id)
}

#[tauri::command]
fn runtime_snapshot(state: State<'_, AppState>) -> workflow::RuntimeSnapshot {
    state.workflow.snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    log_startup(&format!("Rust entry executable={:?}", std::env::current_exe()));
    let store = storage::BlueprintStore::beside_executable().expect("cannot locate the Nodrec application directory");
    log_startup("storage located; building Tauri");
    tauri::Builder::default()
        .plugin(tauri::plugin::Builder::<tauri::Wry>::new("startup-diagnostics")
            .js_init_script(include_str!("../startup.js").to_string()).build())
        .on_page_load(|webview, payload| log_startup(&format!("{} page {:?}", webview.label(), payload.event())))
        .setup(|_| { log_startup("Tauri setup: configured windows created"); Ok(()) })
        .manage(AppState { store, workflow: workflow::WorkflowRuntime::default(), store_lock: Mutex::new(()), shutting_down: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![
            startup_log,
            list_blueprints,
            save_blueprint,
            delete_blueprint,
            restore_blueprint,
            list_node_types,
            list_displays,
            activate_blueprint,
            dispatch_blueprint_event,
            runtime_snapshot,
            region_tool_state,
            region_tool_action,
            region_tool_layout,
            region_tool_shape,
            region_tool_ratio,
            region_tool_dispatch,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() != "main" {
                    if let Some(tool) = window.state::<AppState>().workflow.tools.snapshot() {
                        let _ = window.state::<AppState>().workflow.tools.update(window.app_handle(), &tool.token, &tool.blueprint_id, "hide", None, false);
                    }
                    return;
                }
                window.state::<AppState>().workflow.tools.reset(window.app_handle());
                if window.state::<AppState>().shutting_down.swap(true, Ordering::AcqRel) { return; }
                let runtime = window.state::<AppState>().workflow.clone();
                let window = window.clone();
                std::thread::spawn(move || { runtime.stop_for_shutdown(); let _ = window.destroy(); });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nodrec");
}
