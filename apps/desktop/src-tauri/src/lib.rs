mod storage;
mod workflow;
pub mod recording;

use serde_json::Value;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State};

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
fn activate_blueprint(state: State<'_, AppState>, document: Value) -> Result<workflow::Activation, String> {
    state.workflow.activate(document)
}

#[tauri::command]
fn dispatch_blueprint_event(app: tauri::AppHandle, state: State<'_, AppState>, event_id: String) -> Result<workflow::RuntimeSnapshot, String> {
    state.workflow.dispatch(app, event_id)
}

#[tauri::command]
fn runtime_snapshot(state: State<'_, AppState>) -> workflow::RuntimeSnapshot {
    state.workflow.snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let store = storage::BlueprintStore::beside_executable().expect("cannot locate the Nodrec application directory");
    tauri::Builder::default()
        .manage(AppState { store, workflow: workflow::WorkflowRuntime::default(), store_lock: Mutex::new(()), shutting_down: AtomicBool::new(false) })
        .invoke_handler(tauri::generate_handler![
            list_blueprints,
            save_blueprint,
            delete_blueprint,
            restore_blueprint,
            list_node_types,
            list_displays,
            activate_blueprint,
            dispatch_blueprint_event,
            runtime_snapshot,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.state::<AppState>().shutting_down.swap(true, Ordering::AcqRel) { return; }
                let runtime = window.state::<AppState>().workflow.clone();
                let window = window.clone();
                std::thread::spawn(move || { runtime.stop_for_shutdown(); let _ = window.destroy(); });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Nodrec");
}
