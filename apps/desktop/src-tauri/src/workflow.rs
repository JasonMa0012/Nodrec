use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use crate::recording::{RecordingPlan, RecordingSession, RecordingStats};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePort {
    pub id: &'static str,
    pub label: &'static str,
    pub value_type: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeType {
    pub kind: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    pub inputs: Vec<NodePort>,
    pub outputs: Vec<NodePort>,
    pub input_parameters: Vec<&'static str>,
    pub default_config: Value,
}

fn port(id: &'static str, label: &'static str, value_type: &'static str) -> NodePort {
    NodePort { id, label, value_type }
}

fn node_type(kind: &'static str, label: &'static str, category: &'static str, inputs: Vec<NodePort>, outputs: Vec<NodePort>, input_parameters: Vec<&'static str>, default_config: Value) -> NodeType {
    NodeType { kind, label, category, inputs, outputs, input_parameters, default_config }
}

pub fn node_catalog() -> Vec<NodeType> {
    vec![
        node_type("event", "Event", "Events", vec![], vec![port("flow", "Then", "flow")], vec![], json!({"eventId":"new-event"})),
        node_type("register_control", "Register Control", "Controls", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec!["control.enabled", "control.label", "control.order"], json!({"control":{"id":"new-control","label":"New Control","icon":"circle-help","eventId":"new-event","order":0,"enabled":true,"targets":["main"]}})),
        node_type("select_region", "Select Region", "Capture", vec![port("flow", "Execute", "flow"), port("initialRegion", "Initial Region", "region")], vec![port("selected", "Selected", "flow"), port("cancelled", "Cancelled", "flow"), port("region", "Region", "region")], vec!["display"], json!({"toolId":"capture-region","display":"Display 1","initialRegion":null})),
        node_type("get_selected_region", "Get Selected Region", "Values", vec![port("fallback", "Manual / Full Display", "region")], vec![port("region", "Region", "region")], vec!["mode"], json!({"toolId":"capture-region","mode":"Selected Region"})),
        node_type("register_display", "Register Display", "Controls", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({"display":{"id":"recording-time","targets":["region:capture-region"],"order":0,"source":"elapsed","format":"HH:mm:ss"}})),
        node_type("register_menu", "Register Control Menu", "Controls", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({"controlId":"new-control","path":"Start","icon":"circle-help","eventId":"new-event"})),
        node_type("update_control", "Update Control", "Controls", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec!["patch.label"], json!({"controlId":"new-control","patch":{"label":"New Control"}})),
        node_type("log", "Log", "Flow", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec!["message"], json!({"message":"Workflow action"})),
        node_type("delay", "Delay", "Flow", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec!["milliseconds"], json!({"milliseconds":0})),
        node_type("branch", "Branch", "Flow", vec![port("flow", "Execute", "flow"), port("condition", "Condition", "boolean")], vec![port("true", "True", "flow"), port("false", "False", "flow")], vec!["condition"], json!({"condition":false,"exposedInputs":["condition"]})),
        node_type("read_parameter", "Read Parameter", "Values", vec![], vec![port("value", "Value", "value")], vec![], json!({"parameterId":"fps"})),
        node_type("constant", "Constant", "Values", vec![], vec![port("value", "Value", "value")], vec!["value"], json!({"value":""})),
        node_type("make_boolean", "Make Boolean", "Values", vec![], vec![port("value", "Value", "boolean")], vec!["value"], json!({"value":false})),
        node_type("make_byte", "Make Byte", "Values", vec![], vec![port("value", "Value", "byte")], vec!["value"], json!({"value":0})),
        node_type("make_integer", "Make Integer", "Values", vec![], vec![port("value", "Value", "integer")], vec!["value"], json!({"value":0})),
        node_type("make_integer64", "Make Integer64", "Values", vec![], vec![port("value", "Value", "integer64")], vec!["value"], json!({"value":0})),
        node_type("make_float", "Make Float", "Values", vec![], vec![port("value", "Value", "float")], vec!["value"], json!({"value":0.0})),
        node_type("make_double", "Make Double", "Values", vec![], vec![port("value", "Value", "double")], vec!["value"], json!({"value":0.0})),
        node_type("make_name", "Make Name", "Values", vec![], vec![port("value", "Value", "name")], vec!["value"], json!({"value":"None"})),
        node_type("make_string", "Make String", "Values", vec![], vec![port("value", "Value", "string")], vec!["value"], json!({"value":""})),
        node_type("make_text", "Make Text", "Values", vec![], vec![port("value", "Value", "text")], vec!["value"], json!({"value":""})),
        node_type("compare", "Compare Values", "Values", vec![port("left", "Left", "value"), port("right", "Right", "value")], vec![port("condition", "Condition", "boolean")], vec![], json!({"operator":"equal"})),
        node_type("start_pipeline", "Start Pipeline", "Media", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({"outputNodeId":"write"})),
        node_type("pause_pipeline", "Pause Pipeline", "Media", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({})),
        node_type("resume_pipeline", "Resume Pipeline", "Media", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({})),
        node_type("stop_pipeline", "Stop Pipeline", "Media", vec![port("flow", "Execute", "flow")], vec![port("flow", "Then", "flow")], vec![], json!({})),
        node_type("region", "Screen Region", "Values", vec![], vec![port("region", "Region", "region")], vec!["display", "mode", "x", "y", "width", "height"], json!({"display":"Display 1","mode":"Full Display","x":0,"y":0,"width":897,"height":360})),
        node_type("path", "Output Path", "Values", vec![], vec![port("path", "Path", "path")], vec!["directory", "filename"], json!({"directory":"C:/Recordings","filename":"{blueprint}_{timestamp}.mp4"})),
        node_type("screen", "Capture Screen", "Streams", vec![port("region", "Region", "region")], vec![port("frames", "Frames", "video_frames")], vec!["cursor"], json!({"cursor":true})),
        node_type("audio", "Capture Audio", "Streams", vec![], vec![port("audio", "Audio", "audio_samples")], vec![], json!({})),
        node_type("encode", "Encode H.264", "Streams", vec![port("frames", "Frames", "video_frames"), port("audio", "Audio (not supported yet)", "audio_samples")], vec![port("video", "Video", "encoded_video")], vec!["encoder", "fps", "resolution", "bitrate", "encodingMode"], json!({"encoder":"H.264","fps":60,"resolution":"Source Size","bitrate":"20","encodingMode":"Hardware Auto"})),
        node_type("write", "Write MP4", "Streams", vec![port("video", "Video", "encoded_video"), port("path", "Path", "path")], vec![], vec![], json!({})),
    ]
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLog {
    pub sequence: u64,
    pub blueprint_id: String,
    pub run_id: Option<String>,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub blueprint_id: Option<String>,
    pub run_id: Option<String>,
    pub status: String,
    pub frame_count: u64,
    pub controls: Vec<Value>,
    pub displays: Vec<Value>,
    pub logs: Vec<RuntimeLog>,
    pub error: Option<String>,
    pub recording: Option<RecordingStats>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub controls: Vec<Value>,
    pub diagnostics: Vec<String>,
}

#[derive(Default)]
struct RuntimeState {
    document: Option<Value>,
    blueprint_id: Option<String>,
    run_id: Option<String>,
    status: &'static str,
    generation: u64,
    busy_generation: Option<u64>,
    frame_count: u64,
    log_sequence: u64,
    controls: Vec<Value>,
    logs: VecDeque<RuntimeLog>,
    error: Option<String>,
    session: Option<RecordingSession>,
    recording: Option<RecordingStats>,
}

#[derive(Clone, Default)]
pub struct WorkflowRuntime {
    pub tools: crate::region_tool::RegionTools,
    state: Arc<Mutex<RuntimeState>>,
}

impl WorkflowRuntime {
    pub fn tool_definitions(&self) -> HashMap<String, Value> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.document.as_ref().map(|document| nodes(document).iter().filter(|n| node_kind(n) == "select_region").filter_map(|node| {
            let config = resolved_node_config(document, node).ok()?;
            Some((config["toolId"].as_str()?.to_string(), config.clone()))
        }).collect()).unwrap_or_default()
    }
    pub fn activate(&self, document: Value) -> Result<Activation, String> {
        let diagnostics = validate_document(&document, false);
        let blueprint_id = document.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
        if matches!(state.status, "starting" | "recording" | "paused" | "stopping") {
            if state.blueprint_id.as_deref() != Some(&blueprint_id) {
                return Err("Stop the active workflow before switching blueprints".into());
            }
            if state.document.as_ref() == Some(&document) {
                return Ok(Activation { controls: state.controls.iter().filter(|c| c["kind"] != "display").cloned().collect(), diagnostics });
            }
            return Err("Stop the active workflow before changing its blueprint".into());
        }
        state.generation = state.generation.wrapping_add(1);
        state.busy_generation = None;
        state.document = Some(document.clone());
        state.blueprint_id = Some(blueprint_id);
        state.run_id = None;
        state.frame_count = 0;
        state.error = None;
        state.recording = None;
        state.status = "ready";
        state.controls.clear();
        if diagnostics.is_empty() {
            state.controls = execute_initialization(&document)?;
        }
        Ok(Activation { controls: state.controls.iter().filter(|c| c["kind"] != "display").cloned().collect(), diagnostics })
    }

    fn evaluation_document(&self, document: &Value) -> Value {
        let mut document = document.clone();
        document.as_object_mut().unwrap().remove("_validateRegionStructure");
        document["_selectedRegions"] = json!(self.tools.selected());
        document
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(session) = &state.session {
            let stats = session.stats();
            state.frame_count = stats.encoded_frames;
            if stats.finished && matches!(state.status, "starting" | "recording" | "paused") {
                state.status = if stats.error.is_some() { "failed" } else { "ready" };
                state.error = stats.error.clone();
                state.busy_generation = None;
            }
            state.recording = Some(stats);
        }
        RuntimeSnapshot {
            blueprint_id: state.blueprint_id.clone(),
            run_id: state.run_id.clone(),
            status: state.status.to_string(),
            frame_count: state.frame_count,
            displays: state.controls.iter().filter(|c| c["kind"] == "display").cloned().collect(),
            controls: state.controls.iter().filter(|c| c["kind"] != "display").cloned().collect(),
            logs: state.logs.iter().cloned().collect(),
            error: state.error.clone(),
            recording: state.recording.clone(),
        }
    }

    pub fn dispatch(&self, app: AppHandle, event_id: String) -> Result<RuntimeSnapshot, String> {
        let generation = {
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            let document = state.document.clone().ok_or_else(|| "No blueprint is active".to_string())?;
            if document["supported"] == false { return Err("This blueprint is a preview and cannot run yet".into()); }
            let diagnostics = validate_document(&document, false);
            if let Some(error) = diagnostics.first() { return Err(error.clone()); }
            if state.busy_generation.is_some() {
                if state.status == "starting" && event_pipeline_kind(&self.evaluation_document(&document), &event_id).as_deref() == Some("stop_pipeline") {
                    state.generation = state.generation.wrapping_add(1);
                } else {
                    return Err("Another workflow event is still running".into());
                }
            }
            let action = event_pipeline_kind(&self.evaluation_document(&document), &event_id);
            if matches!(state.status, "starting" | "recording" | "paused" | "stopping") {
                for node in execution_path(&document, &event_id)?.iter().filter(|n| node_kind(n) == "select_region") {
                    if !self.tools.snapshot().is_some_and(|t| t.tool_id == node_config(node)["toolId"].as_str().unwrap_or_default() && t.rect.is_some() && !t.picking) {
                        return Err("Stop recording before selecting a new region".into());
                    }
                }
            }
            if action.as_deref() == Some("start_pipeline") && matches!(state.status, "ready" | "failed") {
                for node in execution_path(&document, &event_id)?.into_iter().filter(|n| node_kind(n) == "start_pipeline") {
                    recording_plan(&self.evaluation_document(&document), node_config(node)["outputNodeId"].as_str())?;
                }
            }
            match (action.as_deref(), state.status) {
                (Some("start_pipeline"), "ready" | "failed") => {
                    state.status = "starting";
                    state.run_id = Some(format!("run-{}", now_nanos()));
                    state.frame_count = 0;
                    state.error = None;
                    state.recording = None;
                }
                (Some("pause_pipeline"), "recording") | (Some("resume_pipeline"), "paused") => {}
                (Some("stop_pipeline"), "starting" | "recording" | "paused" | "failed") => state.status = "stopping",
                (Some("start_pipeline"), _) => return Err("Workflow is already active".into()),
                (Some("pause_pipeline"), _) => return Err("Workflow is not recording".into()),
                (Some("resume_pipeline"), _) => return Err("Workflow is not paused".into()),
                (Some("stop_pipeline"), "ready" | "stopping") => return Err("Workflow is already stopped".into()),
                _ => {}
            }
            state.generation = state.generation.wrapping_add(1);
            state.busy_generation = Some(state.generation);
            state.generation
        };
        self.emit_status(&app);
        let runtime = self.clone();
        thread::spawn(move || runtime.run_event(app, event_id, generation));
        Ok(self.snapshot())
    }

    pub fn stop_for_shutdown(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.generation = state.generation.wrapping_add(1);
        state.busy_generation = None;
        state.status = "ready";
        state.run_id = None;
        let session = state.session.take();
        drop(state);
        if let Some(session) = session { let _ = session.stop(); }
    }

    fn run_event(&self, app: AppHandle, event_id: String, generation: u64) {
        let document = {
            let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            match state.document.clone() { Some(document) => document, None => return }
        };
        let entry = match nodes(&document).iter().find(|node| node_kind(node) == "event" && node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str) == Some(&event_id)) {
            Some(node) => node,
            None => { self.fail(&app, generation, format!("Event '{event_id}' was not found")); return; }
        };
        let mut current = node_id(entry).to_string();
        let mut completed = false;
        for _ in 0..512 {
            if !self.is_current(generation) { return; }
            let Some(node) = nodes(&document).iter().find(|node| node_id(node) == current) else {
                self.fail(&app, generation, format!("Execution path references missing node '{current}'")); return;
            };
            let kind = node.get("data").and_then(|data| data.get("kind")).and_then(Value::as_str).unwrap_or_default();
            let config = match resolved_node_config(&self.evaluation_document(&document), node) {
                Ok(config) => config,
                Err(error) => { self.fail(&app, generation, error); return; }
            };
            let output_handle = if kind == "select_region" {
                let blueprint_id = document["id"].as_str().unwrap_or_default();
                if let Err(error) = self.tools.open(&app, blueprint_id, &config) { self.fail(&app, generation, error); return; }
                loop {
                    if !self.is_current(generation) { return; }
                    match self.tools.snapshot() {
                        Some(tool) if tool.blueprint_id == blueprint_id => {
                            if let Some(selected) = tool.outcome { break if selected { "out:selected" } else { "out:cancelled" }; }
                        }
                        _ => { self.fail(&app, generation, "Region tool closed before selection".into()); return; }
                    }
                    thread::sleep(Duration::from_millis(25));
                }
            } else if kind == "branch" {
                match branch_output(&self.evaluation_document(&document), node) {
                    Ok(handle) => handle,
                    Err(error) => { self.fail(&app, generation, error); return; }
                }
            } else {
                let result = match kind {
                    "event" | "register_control" | "register_menu" | "register_display" => Ok(()),
                    "log" => self.log(&app, config.get("message").and_then(Value::as_str).unwrap_or("Workflow action")),
                    "delay" => {
                        let millis = config.get("milliseconds").and_then(Value::as_u64).unwrap_or(0).min(60_000);
                        for _ in 0..millis {
                            if !self.is_current(generation) { return; }
                            thread::sleep(Duration::from_millis(1));
                        }
                        Ok(())
                    }
                    "update_control" => self.update_control(&app, &config),
                    "start_pipeline" => self.start_pipeline(&app, &document, &config, generation),
                    "pause_pipeline" => self.set_pipeline_state(&app, generation, "recording", "paused", "Pipeline paused"),
                    "resume_pipeline" => self.set_pipeline_state(&app, generation, "paused", "recording", "Pipeline resumed"),
                    "stop_pipeline" => self.stop_pipeline(&app, generation),
                    _ => Err(format!("Node '{kind}' cannot run in an execution chain")),
                };
                if let Err(error) = result { self.fail(&app, generation, error); return; }
                "out:flow"
            };
            let next = edges(&document).iter().find(|edge| edge.get("source").and_then(Value::as_str) == Some(&current) && edge.get("sourceHandle").and_then(Value::as_str) == Some(output_handle));
            let Some(target) = next.and_then(|edge| edge.get("target")).and_then(Value::as_str) else { completed = true; break; };
            current = target.to_string();
        }
        if !self.is_current(generation) { return; }
        if !completed {
            self.fail(&app, generation, "Execution path exceeds 512 nodes".into()); return;
        }
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.generation == generation {
            if state.status == "stopping" { state.status = "ready"; state.run_id = None; }
            state.busy_generation = None;
        }
        drop(state);
        self.emit_status(&app);
    }

    fn start_pipeline(&self, app: &AppHandle, document: &Value, config: &Value, generation: u64) -> Result<(), String> {
        let plan = recording_plan(&self.evaluation_document(document), config.get("outputNodeId").and_then(Value::as_str))?;
        self.tools.enforce_capture_exclusion(app, true);
        let ready = {
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            if state.generation != generation { return Ok(()); }
            if matches!(state.status, "ready" | "failed") {
                state.status = "starting";
                state.run_id = Some(format!("run-{}", now_nanos()));
                state.recording = None;
                state.frame_count = 0;
                state.error = None;
            }
            if state.status != "starting" { return Err("Workflow is already active".into()); }
            let session = RecordingSession::launch(plan);
            let ready = session.ready.clone();
            state.session = Some(session);
            ready
        };
        RecordingSession::wait_for_ready(&ready)?;
        if !self.is_current(generation) { return Ok(()); }
        {
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            if state.generation != generation { return Ok(()); }
            state.status = "recording";
        }
        self.log(app, "Screen capture, H.264 encoding, and MP4 writing are running")?;
        self.emit_status(app);
        let runtime = self.clone();
        let app = app.clone();
        let run_id = self.snapshot().run_id;
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(500));
            let snapshot = runtime.snapshot();
            runtime.emit_status(&app);
            if snapshot.run_id != run_id || !matches!(snapshot.status.as_str(), "recording" | "paused" | "starting") {
                return;
            }
        });
        Ok(())
    }

    fn set_pipeline_state(&self, app: &AppHandle, generation: u64, from: &str, to: &'static str, message: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
        if state.generation != generation { return Ok(()); }
        if state.status != from { return Err(format!("Cannot change pipeline from {} to {to}", state.status)); }
        let session = state.session.as_ref().ok_or_else(|| "No recording session is active".to_string())?;
        session.pause(to == "paused");
        state.status = to;
        let log = self.push_log(&mut state, message.into());
        drop(state);
        let _ = app.emit("workflow-log", &log);
        self.emit_status(app);
        Ok(())
    }

    fn stop_pipeline(&self, app: &AppHandle, generation: u64) -> Result<(), String> {
        let session = {
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            if state.generation != generation { return Ok(()); }
            state.status = "stopping";
            state.session.take()
        };
        self.emit_status(app);
        if let Some(session) = session {
            let stats = session.stop()?;
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            state.frame_count = stats.encoded_frames;
            state.recording = Some(stats);
        }
        let result = self.snapshot().recording.map(|stats| format!("MP4 finalized and closed: {} ({} ms)", stats.output_path, stats.stop_ms.unwrap_or(0)))
            .unwrap_or_else(|| "MP4 finalized: no active recording; pending start cancelled".into());
        self.log(app, &result)?;
        Ok(())
    }
    fn update_control(&self, app: &AppHandle, config: &Value) -> Result<(), String> {
        let id = config.get("controlId").and_then(Value::as_str).ok_or_else(|| "Update Control needs a controlId".to_string())?;
        let patch = config.get("patch").and_then(Value::as_object).ok_or_else(|| "Update Control needs a patch object".to_string())?;
        let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
        {
            let control = state.controls.iter_mut().find(|control| control.get("id").and_then(Value::as_str) == Some(id)).ok_or_else(|| format!("Control '{id}' is not registered"))?;
            let control = control.as_object_mut().ok_or_else(|| "Registered control is invalid".to_string())?;
            for (key, value) in patch { if matches!(key.as_str(), "label" | "icon" | "enabled" | "eventId" | "order") { control.insert(key.clone(), value.clone()); } }
        }
        state.controls.sort_by_key(|item| item.get("order").and_then(Value::as_i64).unwrap_or(0));
        drop(state);
        self.emit_status(app);
        Ok(())
    }

    fn log(&self, app: &AppHandle, message: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
        let log = self.push_log(&mut state, message.to_string());
        drop(state);
        let _ = app.emit("workflow-log", &log);
        Ok(())
    }

    fn push_log(&self, state: &mut RuntimeState, message: String) -> RuntimeLog {
        state.log_sequence = state.log_sequence.wrapping_add(1);
        let log = RuntimeLog {
            sequence: state.log_sequence,
            blueprint_id: state.blueprint_id.clone().unwrap_or_default(),
            run_id: state.run_id.clone(),
            message,
        };
        state.logs.push_back(log.clone());
        if state.logs.len() > 300 { state.logs.pop_front(); }
        log
    }

    fn fail(&self, app: &AppHandle, generation: u64, error: String) {
        let mut state = self.state.lock().unwrap_or_else(|poison| poison.into_inner());
        if state.generation != generation { return; }
        let session = state.session.take();
        if let Some(session) = &session { session.request_stop(); }
        drop(state);
        if let Some(session) = session { let _ = session.stop(); }
        let mut state = self.state.lock().unwrap_or_else(|poison| poison.into_inner());
        if state.generation != generation { return; }
        state.status = "failed";
        state.error = Some(error.clone());
        state.busy_generation = None;
        let log = self.push_log(&mut state, format!("Workflow failed: {error}"));
        drop(state);
        let _ = app.emit("workflow-log", &log);
        self.emit_status(app);
    }

    fn is_current(&self, generation: u64) -> bool {
        self.state.lock().map(|state| state.generation == generation).unwrap_or(false)
    }

    fn emit_status(&self, app: &AppHandle) {
        let snapshot = self.snapshot();
        self.tools.enforce_capture_exclusion(app, matches!(snapshot.status.as_str(), "starting" | "recording" | "paused" | "stopping"));
        let _ = app.emit("workflow-status", &snapshot);
    }
}

fn node_kind(node: &Value) -> &str {
    node.get("data").and_then(|data| data.get("kind")).and_then(Value::as_str).unwrap_or_default()
}

fn node_id(node: &Value) -> &str {
    node.get("id").and_then(Value::as_str).unwrap_or_default()
}

fn edges(document: &Value) -> &[Value] {
    document.get("edges").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn nodes(document: &Value) -> &[Value] {
    document.get("nodes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn find_port<'a>(catalog: &'a [NodeType], kind: &str, handle: &str, direction: &str) -> Option<&'a NodePort> {
    let id = handle.strip_prefix(&format!("{direction}:"))?;
    let node_type = catalog.iter().find(|item| item.kind == kind)?;
    let ports = if direction == "in" { &node_type.inputs } else { &node_type.outputs };
    ports.iter().find(|item| item.id == id)
}

fn node_config(node: &Value) -> &Value {
    node.get("data").and_then(|data| data.get("config")).unwrap_or(&Value::Null)
}

fn config_path_value<'a>(config: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(config, |value, segment| value.get(segment))
}

fn config_value_type(value: &Value) -> Option<&'static str> {
    if value.is_boolean() { Some("boolean") }
    else if value.as_i64().is_some() || value.as_u64().is_some() { Some("integer") }
    else if value.is_number() { Some("float") }
    else if value.is_string() { Some("string") }
    else { None }
}

fn make_value_type(kind: &str) -> Option<&'static str> {
    match kind {
        "make_boolean" => Some("boolean"), "make_byte" => Some("byte"),
        "make_integer" => Some("integer"), "make_integer64" => Some("integer64"),
        "make_float" => Some("float"), "make_double" => Some("double"),
        "make_name" => Some("name"), "make_string" => Some("string"), "make_text" => Some("text"),
        _ => None,
    }
}

fn exposed_parameter_ids(node: &Value, node_type: &NodeType) -> HashSet<String> {
    match node_config(node).get("exposedInputs").and_then(Value::as_array) {
        Some(inputs) => inputs.iter().filter_map(Value::as_str)
            .filter(|id| node_type.input_parameters.contains(id))
            .map(str::to_string).collect(),
        None if node_type.kind == "branch" => HashSet::from(["condition".to_string()]),
        None => HashSet::new(),
    }
}

fn config_input_port_id(kind: &str, path: &str) -> String {
    if kind == "branch" && path == "condition" { path.to_string() } else { format!("param:{path}") }
}

fn node_port_type(document: &Value, catalog: &[NodeType], node: &Value, handle: &str, direction: &str) -> Option<&'static str> {
    let kind = node_kind(node);
    if let Some(port) = find_port(catalog, kind, handle, direction) {
        if direction == "in" && kind == "branch" && port.id == "condition" {
            let node_type = catalog.iter().find(|item| item.kind == kind)?;
            if !exposed_parameter_ids(node, node_type).contains("condition") { return None; }
        }
        if direction == "out" && port.value_type == "value" {
            let value = if kind == "constant" {
                node_config(node).get("value")
            } else if kind == "read_parameter" {
                let id = node_config(node).get("parameterId").and_then(Value::as_str)?;
                document.get("values").and_then(|values| values.get(id))
            } else { None };
            return Some(value.and_then(config_value_type).unwrap_or("value"));
        }
        return Some(port.value_type);
    }
    if direction != "in" { return None; }
    let path = handle.strip_prefix("in:param:")?;
    let node_type = catalog.iter().find(|item| item.kind == kind)?;
    if !node_type.input_parameters.contains(&path) || !exposed_parameter_ids(node, node_type).contains(path) { return None; }
    config_path_value(node_config(node), path)?;
    if path == "value" {
        if let Some(value_type) = make_value_type(kind) { return Some(value_type); }
    }
    let schema = if kind == "constant" && path == "value" { node_config(node) } else { &node_type.default_config };
    config_value_type(config_path_value(schema, path)?)
}

fn compatible_port_types(source: &str, target: &str) -> bool {
    source == target || (source != "flow" && target != "flow" && (source == "value" || target == "value"))
}

fn set_config_path(config: &mut Value, path: &str, value: Value) -> Result<(), String> {
    let mut segments = path.split('.').peekable();
    let mut current = config;
    while let Some(segment) = segments.next() {
        if segments.peek().is_none() {
            let object = current.as_object_mut().ok_or_else(|| format!("Input parameter '{path}' is not an object field"))?;
            if !object.contains_key(segment) { return Err(format!("Input parameter '{path}' no longer exists")); }
            object.insert(segment.to_string(), value);
            return Ok(());
        }
        current = current.get_mut(segment).ok_or_else(|| format!("Input parameter '{path}' no longer exists"))?;
    }
    Err(format!("Input parameter '{path}' is empty"))
}

fn resolved_node_config(document: &Value, node: &Value) -> Result<Value, String> {
    let kind = node_kind(node);
    let catalog = node_catalog();
    let node_type = catalog.iter().find(|item| item.kind == kind).ok_or_else(|| format!("Unknown node type '{kind}'"))?;
    let mut config = node_config(node).clone();
    if matches!(kind, "region" | "screen" | "encode" | "path") {
        let supplied = config.as_object().cloned().unwrap_or_default();
        config = node_type.default_config.clone();
        // Legacy regions described a rectangle before the mode field existed.
        if kind == "region" && !supplied.contains_key("mode") { config["mode"] = json!("Rectangle"); }
        config.as_object_mut().unwrap().extend(supplied);
    }
    if kind == "select_region" {
        if let Some(region) = input_value(document, node_id(node), "initialRegion", &mut HashSet::new(), 0)? { config["initialRegion"] = region; }
    }
    let exposed = exposed_parameter_ids(node, node_type);
    for path in exposed {
        let input = config_input_port_id(kind, &path);
        if let Some(value) = input_value(document, node_id(node), &input, &mut HashSet::new(), 0)? {
            set_config_path(&mut config, &path, value)?;
        }
    }
    Ok(config)
}

pub fn validate_document(document: &Value, for_run: bool) -> Vec<String> {
    let mut errors = Vec::new();
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(crate::storage::SCHEMA_VERSION) {
        errors.push("Unsupported blueprint schema version".into());
    }
    if for_run && document.get("supported").and_then(Value::as_bool) == Some(false) {
        errors.push("This blueprint is a preview and cannot run yet".into());
    }
    let Some(node_values) = document.get("nodes").and_then(Value::as_array) else {
        errors.push("Blueprint nodes must be an array".into());
        return errors;
    };
    let Some(edge_values) = document.get("edges").and_then(Value::as_array) else {
        errors.push("Blueprint edges must be an array".into());
        return errors;
    };
    if node_values.len() > 2048 || edge_values.len() > 8192 {
        errors.push("Blueprint graph exceeds the supported node or connection limit".into());
        return errors;
    }
    let catalog = node_catalog();
    let mut by_id = HashMap::new();
    let mut event_ids = HashSet::new();
    let mut edge_ids = HashSet::new();
    for node in node_values {
        let id = node_id(node);
        if id.is_empty() || by_id.insert(id, node).is_some() { errors.push(format!("Node ID '{id}' is empty or duplicated")); continue; }
        let kind = node_kind(node);
        let node_type = catalog.iter().find(|item| item.kind == kind);
        if node_type.is_none() { errors.push(format!("Unknown node type '{kind}'")); }
        if node.get("type").and_then(Value::as_str) != Some(kind) { errors.push(format!("Node '{id}' visual type does not match its registered kind")); }
        if let Some(inputs) = node_config(node).get("exposedInputs") {
            if let Some(inputs) = inputs.as_array() {
                let mut seen = HashSet::new();
                for input in inputs {
                    let Some(path) = input.as_str() else { errors.push(format!("Node '{id}' has an invalid exposed input")); continue; };
                    if !seen.insert(path) { errors.push(format!("Node '{id}' exposes input '{path}' more than once")); }
                    let Some(node_type) = node_type else { continue; };
                    if !node_type.input_parameters.contains(&path) { errors.push(format!("Node '{id}' cannot expose parameter '{path}' as an input")); continue; }
                    let input_type = if path == "value" { make_value_type(kind) } else { None }
                        .or_else(|| config_path_value(&node_type.default_config, path).and_then(config_value_type));
                    if config_path_value(node_config(node), path).is_none() || input_type.is_none() { errors.push(format!("Node '{id}' input parameter '{path}' must be a boolean, number, or string")); }
                }
            } else { errors.push(format!("Node '{id}' exposedInputs must be an array")); }
        }
        if kind == "event" {
            let event_id = node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str).unwrap_or_default();
            if event_id.is_empty() || !event_ids.insert(event_id) { errors.push(format!("Event ID '{event_id}' is empty or duplicated")); }
        }
    }
    let mut incoming = HashSet::new();
    let mut outgoing_flow = HashSet::new();
    let mut adjacency: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in edge_values {
        let edge_id = edge.get("id").and_then(Value::as_str).unwrap_or_default();
        if edge_id.is_empty() || !edge_ids.insert(edge_id) { errors.push(format!("Connection ID '{edge_id}' is empty or duplicated")); }
        let source = edge.get("source").and_then(Value::as_str).unwrap_or_default();
        let target = edge.get("target").and_then(Value::as_str).unwrap_or_default();
        let source_handle = edge.get("sourceHandle").and_then(Value::as_str).unwrap_or_default();
        let target_handle = edge.get("targetHandle").and_then(Value::as_str).unwrap_or_default();
        let (Some(source_node), Some(target_node)) = (by_id.get(source), by_id.get(target)) else {
            errors.push(format!("Connection '{}' references a missing node", edge.get("id").and_then(Value::as_str).unwrap_or("")));
            continue;
        };
        if source == target { errors.push(format!("Connection '{source}' cannot point to itself")); }
        let Some(from_type) = node_port_type(document, &catalog, source_node, source_handle, "out") else {
            errors.push(format!("Connection from '{source}' uses invalid output '{source_handle}'"));
            continue;
        };
        let Some(to_type) = node_port_type(document, &catalog, target_node, target_handle, "in") else {
            errors.push(format!("Connection to '{target}' uses invalid input '{target_handle}'"));
            continue;
        };
        if !compatible_port_types(from_type, to_type) { errors.push(format!("Connection '{source}' to '{target}' has incompatible types")); }
        if !incoming.insert((target, target_handle)) { errors.push(format!("Input '{target}.{target_handle}' has multiple connections")); }
        if from_type == "flow" && !outgoing_flow.insert((source, source_handle)) { errors.push(format!("Execution output '{source}.{source_handle}' has multiple successors")); }
        adjacency.entry(source).or_default().push(target);
    }
    if has_cycle(&by_id, &adjacency) { errors.push("Workflow graph contains a cycle".into()); }
    validate_tools(document, &mut errors);
    let mut registered = HashSet::new();
    for node in node_values.iter().filter(|node| node_kind(node) == "register_control") {
        let config = node.get("data").and_then(|data| data.get("config"));
        let Some(control) = config.and_then(|config| config.get("control")) else { errors.push(format!("Register Control '{}' needs a control definition", node_id(node))); continue; };
        let id = control.get("id").and_then(Value::as_str).unwrap_or_default();
        let event_id = control.get("eventId").and_then(Value::as_str).unwrap_or_default();
        if id.is_empty() || !registered.insert(id) { errors.push(format!("Control ID '{id}' is empty or duplicated")); }
        if control.get("label").and_then(Value::as_str).is_none_or(str::is_empty) { errors.push(format!("Control '{id}' needs a label")); }
        if control.get("order").is_some_and(|order| order.as_i64().is_none()) { errors.push(format!("Control '{id}' order must be an integer")); }
        if !event_ids.contains(event_id) { errors.push(format!("Control '{id}' references missing Event '{event_id}'")); }
        if !valid_icon(control.get("icon").and_then(Value::as_str).unwrap_or_default()) { errors.push(format!("Control '{id}' uses an unsupported icon")); }
        if control.get("enabled").is_some_and(|enabled| !enabled.is_boolean()) { errors.push(format!("Control '{id}' enabled must be a boolean")); }
        if control.get("menu").is_some() { errors.push(format!("Control '{id}' menus must use Register Control Menu nodes")); }
    }
    let mut menu_paths: HashMap<&str, HashSet<String>> = HashMap::new();
    for node in node_values.iter().filter(|node| node_kind(node) == "register_menu") {
        let config = node.get("data").and_then(|data| data.get("config"));
        let control_id = config.and_then(|config| config.get("controlId")).and_then(Value::as_str).unwrap_or_default();
        let path = config.and_then(|config| config.get("path")).and_then(Value::as_str).unwrap_or_default();
        let event_id = config.and_then(|config| config.get("eventId")).and_then(Value::as_str).unwrap_or_default();
        let Some(segments) = menu_path_segments(path) else { errors.push(format!("Register Control Menu '{}' needs a valid slash-separated path", node_id(node))); continue; };
        if !registered.contains(control_id) { errors.push(format!("Register Control Menu '{}' references unregistered control '{control_id}'", node_id(node))); }
        if !event_ids.contains(event_id) { errors.push(format!("Register Control Menu '{}' references missing Event '{event_id}'", node_id(node))); }
        if !valid_icon(config.and_then(|config| config.get("icon")).and_then(Value::as_str).unwrap_or_default()) { errors.push(format!("Register Control Menu '{}' uses an unsupported icon", node_id(node))); }
        let normalized_path = segments.join("/");
        let paths = menu_paths.entry(control_id).or_default();
        if paths.len() >= 128 || !paths.insert(normalized_path.clone()) { errors.push(format!("Control '{control_id}' has too many or duplicate menu paths")); }
    }
    for (control_id, paths) in &menu_paths {
        for path in paths {
            let segments = path.split('/').collect::<Vec<_>>();
            for depth in 1..segments.len() {
                let parent = segments[..depth].join("/");
                if !paths.contains(&parent) { errors.push(format!("Control '{control_id}' menu path '{path}' is missing parent '{parent}'")); }
            }
        }
    }
    for node in node_values.iter().filter(|node| node_kind(node) == "update_control") {
        let config = node.get("data").and_then(|data| data.get("config"));
        let id = config.and_then(|config| config.get("controlId")).and_then(Value::as_str).unwrap_or_default();
        if !registered.contains(id) { errors.push(format!("Update Control '{}' references unregistered control '{id}'", node_id(node))); }
        if let Some(patch) = config.and_then(|config| config.get("patch")).and_then(Value::as_object) {
            if patch.get("eventId").and_then(Value::as_str).is_some_and(|event_id| !event_ids.contains(event_id)) { errors.push(format!("Update Control '{}' references a missing Event", node_id(node))); }
            if patch.get("icon").and_then(Value::as_str).is_some_and(|icon| !valid_icon(icon)) { errors.push(format!("Update Control '{}' uses an unsupported icon", node_id(node))); }
            if patch.get("label").and_then(Value::as_str).is_some_and(str::is_empty) { errors.push(format!("Update Control '{}' has an empty label", node_id(node))); }
            if patch.get("order").is_some_and(|order| order.as_i64().is_none()) { errors.push(format!("Update Control '{}' order must be an integer", node_id(node))); }
        }
    }
    for node in node_values.iter().filter(|node| node_kind(node) == "delay") {
        let millis = node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("milliseconds")).and_then(Value::as_u64).unwrap_or(0);
        if millis > 60_000 { errors.push(format!("Delay '{}' exceeds the 60 second limit", node_id(node))); }
    }
    if node_values.iter().any(|node| matches!(node_kind(node), "register_control" | "register_menu" | "register_display")) && !event_ids.contains("event-initialize") {
        errors.push("Control registration nodes require an Event with ID 'event-initialize'".into());
    }
    for node in node_values.iter().filter(|node| node_kind(node) == "read_parameter") {
        let id = node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("parameterId")).and_then(Value::as_str).unwrap_or_default();
        if document.get("values").and_then(|values| values.get(id)).is_none() { errors.push(format!("Read Parameter '{}' references missing parameter '{id}'", node_id(node))); }
    }
    for node in node_values.iter().filter(|node| matches!(node_kind(node), "constant" | "make_boolean" | "make_byte" | "make_integer" | "make_integer64" | "make_float" | "make_double" | "make_name" | "make_string" | "make_text")) {
        let value = node_config(node).get("value");
        let valid = match node_kind(node) {
            "constant" => value.is_some_and(|value| value.is_string() || value.is_boolean() || value.is_number()),
            "make_boolean" => value.is_some_and(Value::is_boolean),
            "make_byte" => value.and_then(Value::as_i64).is_some_and(|value| (0..=255).contains(&value)),
            "make_integer" => value.is_some_and(|value| value.as_i64().is_some()),
            "make_integer64" => value.is_some_and(|value| value.as_i64().is_some()),
            "make_float" => value.is_some_and(Value::is_number),
            "make_double" => value.is_some_and(Value::is_number),
            "make_name" | "make_string" | "make_text" => value.is_some_and(Value::is_string),
            _ => false,
        };
        if !valid { errors.push(format!("Node '{}' has a missing or invalid typed value", node_id(node))); }
    }
    for node in node_values.iter().filter(|node| node_kind(node) == "compare") {
        let operator = node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("operator")).and_then(Value::as_str).unwrap_or_default();
        if !matches!(operator, "equal" | "not_equal" | "contains") { errors.push(format!("Compare Values '{}' has an unsupported operator", node_id(node))); }
    }
    if for_run && errors.is_empty() {
        if !errors.is_empty() { return errors; }
        let start_events: Vec<_> = node_values.iter().filter(|node| node_kind(node) == "event" && node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str) == Some("event-start")).collect();
        if start_events.is_empty() { errors.push("Blueprint has no Event with ID 'event-start'".into()); }
        for start in start_events {
            let event_id = start.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str).unwrap_or_default();
            match reachable_flow_nodes(document, event_id) {
                Ok(reachable) => {
                    let pipelines: Vec<_> = reachable.into_iter().filter(|node| node_kind(node) == "start_pipeline").collect();
                    if pipelines.is_empty() { errors.push("Event 'event-start' has no Start Pipeline action".into()); }
                    for start_node in pipelines {
                        let output = start_node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("outputNodeId")).and_then(Value::as_str);
                        let mut validation_document = document.clone();
                        validation_document["_validateRegionStructure"] = json!(true);
                        if let Err(error) = recording_plan(&validation_document, output) { errors.push(error); }
                    }
                }
                Err(error) => errors.push(error),
            }
        }
    }
    errors
}

fn selected_region(document: &Value, node: &Value) -> Result<Value, String> {
    let config = resolved_node_config(document, node)?;
    if node_kind(node) == "get_selected_region" && config["mode"] != "Selected Region" {
        let fallback = pipeline_source(document, node_id(node), "fallback", "region", "region")?;
        let mut region = evaluate_value(document, node_id(fallback), &mut HashSet::new(), 0)?;
        region["mode"] = config["mode"].clone();
        return Ok(region);
    }
    let tool = config["toolId"].as_str().unwrap_or_default();
    if let Some(region) = document.get("_selectedRegions").and_then(|r| r.get(tool)) { return Ok(region.clone()); }
    if document["_validateRegionStructure"] == true {
        return Ok(json!({"display":"Display 1","mode":"Rectangle","x":0,"y":0,"width":16,"height":16}));
    }
    Err(format!("Select a region with tool '{tool}' before starting"))
}

fn validate_tools(document: &Value, errors: &mut Vec<String>) {
    let mut tools = HashSet::new();
    for node in nodes(document).iter().filter(|n| node_kind(n) == "select_region") {
        let id = node_config(node)["toolId"].as_str().unwrap_or_default();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || !tools.insert(id) {
            errors.push(format!("Tool ID '{id}' is invalid or duplicated"));
        }
    }
    let mut ids = HashSet::new();
    for node in nodes(document) {
        let config = node_config(node);
        if node_kind(node) == "get_selected_region" && !tools.contains(config["toolId"].as_str().unwrap_or_default()) { errors.push("Get Selected Region references a missing tool".into()); }
        let item = match node_kind(node) { "register_control" => &config["control"], "register_display" => &config["display"], _ => continue };
        let id = item["id"].as_str().unwrap_or_default();
        if id.is_empty() || !ids.insert(id) { errors.push(format!("UI item ID '{id}' is empty or duplicated")); }
        if node_kind(node) == "register_display" {
            if !matches!(item["source"].as_str(), Some("status" | "elapsed")) { errors.push(format!("Display '{id}' has an invalid data source")); }
            let expected = if item["source"] == "elapsed" { "HH:mm:ss" } else { "text" };
            if item["format"].as_str() != Some(expected) { errors.push(format!("Display '{id}' requires format '{expected}'")); }
            if item["order"].as_i64().is_none() { errors.push(format!("Display '{id}' needs integer Order")); }
        }
        if let Some(targets) = item.get("targets") {
            match targets.as_array() {
                Some(targets) if !targets.is_empty() => {
                    let mut seen = HashSet::new();
                    for target in targets {
                        let target = target.as_str().unwrap_or_default();
                        if !seen.insert(target) || !(target == "main" || target.strip_prefix("region:").is_some_and(|id| tools.contains(id))) {
                            errors.push(format!("UI item '{id}' references invalid or duplicate target '{target}'"));
                        }
                    }
                }
                _ => errors.push(format!("UI item '{id}' needs at least one target")),
            }
        }
    }
}

fn valid_icon(icon: &str) -> bool {
    matches!(icon, "circle-help" | "crop" | "monitor" | "play" | "pause" | "square" | "stop-circle" | "settings" | "video" | "folder" | "mouse-pointer-2" | "audio-lines" | "clock-3")
}

fn menu_path_segments(path: &str) -> Option<Vec<String>> {
    if path.trim().is_empty() || path.len() > 512 { return None; }
    let segments = path.split('/').map(str::trim).collect::<Vec<_>>();
    if segments.is_empty() || segments.len() > 8 || segments.iter().any(|segment| segment.is_empty() || segment.len() > 80) { return None; }
    Some(segments.into_iter().map(str::to_string).collect())
}

fn has_cycle<'a>(nodes: &HashMap<&'a str, &Value>, adjacency: &HashMap<&'a str, Vec<&'a str>>) -> bool {
    fn visit<'a>(id: &'a str, nodes: &HashMap<&'a str, &Value>, adjacency: &HashMap<&'a str, Vec<&'a str>>, visiting: &mut HashSet<&'a str>, visited: &mut HashSet<&'a str>) -> bool {
        if visiting.contains(id) { return true; }
        if !visited.insert(id) { return false; }
        visiting.insert(id);
        if adjacency.get(id).is_some_and(|targets| targets.iter().any(|target| nodes.contains_key(target) && visit(target, nodes, adjacency, visiting, visited))) { return true; }
        visiting.remove(id);
        false
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    nodes.keys().any(|id| visit(id, nodes, adjacency, &mut visiting, &mut visited))
}

fn execution_path<'a>(document: &'a Value, event_id: &str) -> Result<Vec<&'a Value>, String> {
    let entry = nodes(document).iter().find(|node| node_kind(node) == "event" && node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str) == Some(event_id))
        .ok_or_else(|| format!("Event '{event_id}' was not found"))?;
    let mut path = vec![entry];
    let mut current = node_id(entry);
    for _ in 0..512 {
        let node = path.last().copied().expect("event path has an entry");
        let output = if node_kind(node) == "branch" { branch_output(document, node)? } else { "out:flow" };
        let next = edges(document).iter().find(|edge| edge.get("source").and_then(Value::as_str) == Some(current) && edge.get("sourceHandle").and_then(Value::as_str) == Some(output));
        let Some(edge) = next else { return Ok(path); };
        let target = edge.get("target").and_then(Value::as_str).unwrap_or_default();
        let node = nodes(document).iter().find(|node| node_id(node) == target).ok_or_else(|| format!("Execution path references missing node '{target}'"))?;
        if !matches!(node_kind(node), "register_control" | "register_menu" | "register_display" | "select_region" | "update_control" | "log" | "delay" | "branch" | "start_pipeline" | "pause_pipeline" | "resume_pipeline" | "stop_pipeline") {
            return Err(format!("Node '{}' cannot appear in an execution chain", node_id(node)));
        }
        path.push(node);
        current = target;
    }
    Err("Execution path exceeds 512 nodes".into())
}

fn reachable_flow_nodes<'a>(document: &'a Value, event_id: &str) -> Result<Vec<&'a Value>, String> {
    let entry = nodes(document).iter().find(|node| node_kind(node) == "event" && node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("eventId")).and_then(Value::as_str) == Some(event_id))
        .ok_or_else(|| format!("Event '{event_id}' was not found"))?;
    let catalog = node_catalog();
    let mut queue = VecDeque::from([entry]);
    let mut seen = HashSet::new();
    let mut reachable = Vec::new();
    while let Some(node) = queue.pop_front() {
        if !seen.insert(node_id(node)) { continue; }
        reachable.push(node);
        if reachable.len() > 512 { return Err("Execution graph exceeds 512 reachable nodes".into()); }
        for edge in edges(document).iter().filter(|edge| edge.get("source").and_then(Value::as_str) == Some(node_id(node))) {
            let output = edge.get("sourceHandle").and_then(Value::as_str).unwrap_or_default();
            if find_port(&catalog, node_kind(node), output, "out").is_some_and(|port| port.value_type == "flow") {
                if let Some(target) = edge.get("target").and_then(Value::as_str).and_then(|id| nodes(document).iter().find(|node| node_id(node) == id)) { queue.push_back(target); }
            }
        }
    }
    Ok(reachable)
}

fn branch_output(document: &Value, node: &Value) -> Result<&'static str, String> {
    let id = node_id(node);
    let condition = match input_value(document, id, "condition", &mut HashSet::new(), 0)? {
        Some(value) => value,
        None => node.get("data").and_then(|data| data.get("config")).and_then(|config| config.get("condition")).cloned()
            .ok_or_else(|| format!("Branch '{id}' needs a boolean condition"))?,
    };
    match condition.as_bool() {
        Some(true) => Ok("out:true"),
        Some(false) => Ok("out:false"),
        None => Err(format!("Branch '{id}' condition did not evaluate to a boolean")),
    }
}

fn input_value(document: &Value, target_id: &str, input: &str, visiting: &mut HashSet<String>, depth: usize) -> Result<Option<Value>, String> {
    let edge = edges(document).iter().find(|edge| edge.get("target").and_then(Value::as_str) == Some(target_id) && edge.get("targetHandle").and_then(Value::as_str) == Some(&format!("in:{input}")));
    let Some(source) = edge.and_then(|edge| edge.get("source")).and_then(Value::as_str) else { return Ok(None); };
    evaluate_value(document, source, visiting, depth + 1).map(Some)
}

fn evaluate_value(document: &Value, id: &str, visiting: &mut HashSet<String>, depth: usize) -> Result<Value, String> {
    if depth > 128 { return Err("Value evaluation exceeds 128 connected nodes".into()); }
    if !visiting.insert(id.to_string()) { return Err(format!("Value graph contains a cycle at '{id}'")); }
    let result = (|| {
        let node = nodes(document).iter().find(|node| node_id(node) == id).ok_or_else(|| format!("Value node '{id}' was not found"))?;
        let config = resolved_node_config(document, node)?;
        match node_kind(node) {
            "region" => Ok(config.clone()),
            "select_region" | "get_selected_region" => selected_region(document, node),
            "constant" => config.get("value").cloned().filter(|value| value.is_string() || value.is_boolean() || value.is_number()).ok_or_else(|| format!("Constant '{id}' must contain a string, boolean, or number")),
            "make_boolean" => config.get("value").cloned().filter(Value::is_boolean).ok_or_else(|| format!("Make Boolean '{id}' needs a boolean value")),
            "make_byte" => config.get("value").cloned().filter(|value| value.as_i64().is_some_and(|value| (0..=255).contains(&value))).ok_or_else(|| format!("Make Byte '{id}' needs a value from 0 to 255")),
            "make_integer" => config.get("value").cloned().filter(|value| value.as_i64().is_some()).ok_or_else(|| format!("Make Integer '{id}' needs an integer value")),
            "make_integer64" => config.get("value").cloned().filter(|value| value.as_i64().is_some()).ok_or_else(|| format!("Make Integer64 '{id}' needs an integer value")),
            "make_float" => config.get("value").cloned().filter(Value::is_number).ok_or_else(|| format!("Make Float '{id}' needs a number value")),
            "make_double" => config.get("value").cloned().filter(Value::is_number).ok_or_else(|| format!("Make Double '{id}' needs a number value")),
            "make_name" => config.get("value").cloned().filter(Value::is_string).ok_or_else(|| format!("Make Name '{id}' needs a string value")),
            "make_string" => config.get("value").cloned().filter(Value::is_string).ok_or_else(|| format!("Make String '{id}' needs a string value")),
            "make_text" => config.get("value").cloned().filter(Value::is_string).ok_or_else(|| format!("Make Text '{id}' needs a string value")),
            "read_parameter" => {
                let key = config.get("parameterId").and_then(Value::as_str).ok_or_else(|| format!("Read Parameter '{id}' needs a parameterId"))?;
                document.get("values").and_then(|values| values.get(key)).cloned().filter(|value| value.is_string() || value.is_boolean() || value.is_number()).ok_or_else(|| format!("Parameter '{key}' has no supported value"))
            }
            "compare" => {
                let left = input_value(document, id, "left", visiting, depth)?.ok_or_else(|| format!("Compare Values '{id}' needs a Left input"))?;
                let right = input_value(document, id, "right", visiting, depth)?.ok_or_else(|| format!("Compare Values '{id}' needs a Right input"))?;
                let operator = config.get("operator").and_then(Value::as_str).unwrap_or("equal");
                let result = match operator {
                    "equal" => left == right,
                    "not_equal" => left != right,
                    "contains" => left.as_str().zip(right.as_str()).is_some_and(|(left, right)| left.contains(right)),
                    _ => return Err(format!("Compare Values '{id}' has an unsupported operator")),
                };
                Ok(Value::Bool(result))
            }
            kind => Err(format!("Node '{kind}' does not produce a value")),
        }
    })();
    visiting.remove(id);
    result
}

fn event_pipeline_kind(document: &Value, event_id: &str) -> Option<String> {
    execution_path(document, event_id).ok()?.into_iter().find_map(|node| match node_kind(node) {
        kind @ ("start_pipeline" | "pause_pipeline" | "resume_pipeline" | "stop_pipeline") => Some(kind.to_string()),
        _ => None,
    })
}

fn execute_initialization(document: &Value) -> Result<Vec<Value>, String> {
    let mut controls = Vec::new();
    let mut menus = Vec::new();
    for node in execution_path(document, "event-initialize")? {
        if matches!(node_kind(node), "register_control" | "register_display") {
            let config = resolved_node_config(document, node)?;
            let is_display = node_kind(node) == "register_display";
            let control = config.get(if is_display { "display" } else { "control" })
                .ok_or_else(|| format!("Register Control '{}' has no definition", node_id(node)))?;
            let mut control = control.clone();
            let object = control.as_object_mut().ok_or_else(|| format!("Register Control '{}' definition must be an object", node_id(node)))?;
            let order = object.get("order").and_then(Value::as_i64).unwrap_or(controls.len() as i64);
            if is_display { object.insert("kind".into(), json!("display")); }
            object.entry("targets").or_insert(json!(["main"]));
            object.insert("menu".into(), json!([]));
            object.insert("order".into(), json!(order));
            controls.push((order, controls.len(), control));
        } else if node_kind(node) == "register_menu" {
            let config = resolved_node_config(document, node)?;
            let path = config.get("path").and_then(Value::as_str).unwrap_or_default();
            menus.push((
                config.get("controlId").and_then(Value::as_str).unwrap_or_default().to_string(),
                menu_path_segments(path).ok_or_else(|| format!("Register Control Menu '{}' has an invalid path", node_id(node)))?,
                config.get("icon").and_then(Value::as_str).unwrap_or_default().to_string(),
                config.get("eventId").and_then(Value::as_str).unwrap_or_default().to_string(),
                menus.len(),
            ));
        }
    }
    menus.sort_by_key(|(_, segments, _, _, order)| (segments.len(), *order));
    for (control_id, segments, icon, event_id, _) in menus {
        let (_, _, control) = controls.iter_mut().find(|(_, _, control)| control.get("id").and_then(Value::as_str) == Some(control_id.as_str()))
            .ok_or_else(|| format!("Register Control Menu references unregistered control '{control_id}'"))?;
        let menu = control.as_object_mut().and_then(|object| object.get_mut("menu")).and_then(Value::as_array_mut).expect("menu initialized");
        insert_menu_path(menu, &segments, 0, &icon, &event_id)?;
    }
    controls.sort_by_key(|(order, registration_index, _)| (*order, *registration_index));
    Ok(controls.into_iter().map(|(_, _, control)| control).collect())
}

fn insert_menu_path(items: &mut Vec<Value>, segments: &[String], depth: usize, icon: &str, event_id: &str) -> Result<(), String> {
    let path = segments[..=depth].join("/");
    if depth + 1 == segments.len() {
        if items.iter().any(|item| item.get("id").and_then(Value::as_str) == Some(path.as_str())) { return Err(format!("Menu path '{path}' is registered more than once")); }
        items.push(json!({"id":path,"label":segments[depth],"icon":icon,"eventId":event_id,"children":[]}));
        return Ok(());
    }
    let parent = items.iter_mut().find(|item| item.get("id").and_then(Value::as_str) == Some(path.as_str()))
        .ok_or_else(|| format!("Menu path '{}' is missing registered parent '{path}'", segments.join("/")))?;
    let children = parent.get_mut("children").and_then(Value::as_array_mut).ok_or_else(|| format!("Menu path '{path}' has invalid children"))?;
    insert_menu_path(children, segments, depth + 1, icon, event_id)
}

fn pipeline_source<'a>(document: &'a Value, target: &str, input: &str, kind: &str, output: &str) -> Result<&'a Value, String> {
    let incoming: Vec<_> = edges(document).iter().filter(|edge| edge["target"] == target && edge["targetHandle"] == format!("in:{input}")).collect();
    if incoming.len() != 1 { return Err(format!("Connect exactly one {kind} source to {target}.{input}")); }
    let edge = incoming[0];
    let source = nodes(document).iter().find(|node| node["id"] == edge["source"])
        .ok_or_else(|| format!("Missing source for {target}.{input}"))?;
    if (node_kind(source) != kind && !(kind == "region" && matches!(node_kind(source), "select_region" | "get_selected_region"))) || edge["sourceHandle"] != format!("out:{output}") { return Err(format!("{target}.{input} requires {kind}.{output}")); }
    if matches!(kind, "screen" | "encode") && edges(document).iter().filter(|edge| edge["source"] == node_id(source) && edge["sourceHandle"] == format!("out:{output}")).count() != 1 {
        return Err("Recording supports one source, one encoder and one output per run".into());
    }
    Ok(source)
}

fn recording_plan(document: &Value, output_id: Option<&str>) -> Result<RecordingPlan, String> {
    let output = nodes(document).iter().find(|node| Some(node_id(node)) == output_id && node_kind(node) == "write")
        .ok_or_else(|| "Start Pipeline must reference a Write MP4 node".to_string())?;
    let encoder = pipeline_source(document, node_id(output), "video", "encode", "video")?;
    if edges(document).iter().any(|edge| edge["target"] == node_id(encoder) && edge["targetHandle"] == "in:audio") {
        return Err("Audio recording is not implemented yet; disconnect the audio input".into());
    }
    let screen = pipeline_source(document, node_id(encoder), "frames", "screen", "frames")?;
    let region = pipeline_source(document, node_id(screen), "region", "region", "region")?;
    let path = pipeline_source(document, node_id(output), "path", "path", "path")?;
    let e = resolved_node_config(document, encoder)?;
    let r = if node_kind(region) == "region" { resolved_node_config(document, region)? } else { selected_region(document, region)? };
    let s = resolved_node_config(document, screen)?;
    let p = resolved_node_config(document, path)?;
    let string = |value: &Value, key: &str| -> Result<String, String> { value.get(key).and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("{key} must be a string")) };
    let number = |value: &Value, key: &str| -> Result<u32, String> {
        let number = value.get(key).and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
        number.and_then(|n| u32::try_from(n).ok()).ok_or_else(|| format!("{key} must be a nonnegative integer"))
    };
    if string(&e, "encoder")? != "H.264" { return Err("Only H.264 encoding is supported".into()); }
    let mode = string(&r, "mode")?;
    if !["Full Display", "Rectangle"].contains(&mode.as_str()) { return Err("Region mode must be Full Display or Rectangle".into()); }
    let encoding = string(&e, "encodingMode")?;
    if !["Hardware Auto", "Software"].contains(&encoding.as_str()) { return Err("Encoding mode must be Hardware Auto or Software".into()); }
    let (ow, oh) = match string(&e, "resolution")?.as_str() {
        "Source Size" | "Source size" => (0,0),
        "1920 × 1080" => (1920,1080), "2560 × 1440" => (2560,1440),
        _ => return Err("Resolution must be Source Size, 1920 × 1080, or 2560 × 1440".into()),
    };
    let bitrate = e.get("bitrate").and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .filter(|n| n.is_finite() && (0.1..=200.).contains(n)).ok_or_else(|| "Bitrate must be between 0.1 and 200 Mbps".to_string())?;
    let fps = number(&e,"fps")?;
    if ![24,30,60,120].contains(&fps) { return Err("Frame rate must be 24, 30, 60, or 120".into()); }
    let mut filename = string(&p, "filename")?.replace("{blueprint}", document["id"].as_str().unwrap_or("recording")).replace("{timestamp}", &now_nanos().to_string());
    if !filename.to_ascii_lowercase().ends_with(".mp4") { filename.push_str(".mp4"); }
    if filename.contains(['/', '\\', ':', '{', '}']) || filename == ".mp4" { return Err("Filename must be a filename, with only {blueprint} and {timestamp} placeholders".into()); }
    let width = number(&r,"width")?; let height = number(&r,"height")?;
    if mode == "Rectangle" && (width == 0 || height == 0) { return Err("Rectangle width and height must be positive".into()); }
    Ok(RecordingPlan {
        display: string(&r,"display")?, full_display: mode == "Full Display", x: number(&r,"x")?, y: number(&r,"y")?, width, height,
        output_width: ow, output_height: oh, fps, bitrate: (bitrate*1_000_000.).round() as u32,
        software: encoding == "Software", cursor: s.get("cursor").and_then(Value::as_bool).ok_or_else(|| "Cursor must be a boolean".to_string())?,
        path: std::path::Path::new(&string(&p,"directory")?).join(filename),
    })
}
fn now_nanos() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn region_ui_registry_and_live_values() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        assert!(validate_document(&doc, true).is_empty(), "{:?}", validate_document(&doc, true));
        let ui = execute_initialization(&doc).unwrap();
        assert_eq!(ui.iter().filter(|c| c["kind"] == "display").count(), 2);
        assert_eq!(ui.iter().find(|c| c["id"] == "start-recording").unwrap()["targets"], json!(["main", "region:capture-region"]));
        assert!(recording_plan(&doc, Some("write")).unwrap_err().contains("Select a region"));
        doc["_selectedRegions"] = json!({"capture-region":{"display":"test-display","mode":"Rectangle","x":23,"y":41,"width":897,"height":360}});
        let first = recording_plan(&doc, Some("write")).unwrap();
        assert_eq!((first.x,first.y,first.width),(23,41,897));
        doc["_selectedRegions"]["capture-region"]["x"] = json!(105);
        assert_eq!(recording_plan(&doc, Some("write")).unwrap().x,105);
        doc["values"]["regionMode"] = json!("Full Display");
        assert!(recording_plan(&doc, Some("write")).unwrap().full_display);
        doc["values"]["regionMode"] = json!("Rectangle");
        assert_eq!(recording_plan(&doc, Some("write")).unwrap().x, 0);
    }

    #[test]
    fn ui_targets_and_display_sources_are_validated() {
        let doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        for (id, field, bad) in [("register-start", "control", json!({"targets":["region:missing"]})), ("register-status", "display", json!({"source":"unsupported"})), ("register-time", "display", json!({"id":"start-recording"}))] {
            let mut bad_doc = doc.clone();
            let node = bad_doc["nodes"].as_array_mut().unwrap().iter_mut().find(|n| n["id"] == id).unwrap();
            node["data"]["config"][field].as_object_mut().unwrap().extend(bad.as_object().unwrap().clone());
            assert!(!validate_document(&bad_doc, false).is_empty());
        }
        let mut legacy = document();
        legacy["nodes"][1]["data"]["config"]["control"].as_object_mut().unwrap().remove("targets");
        assert_eq!(execute_initialization(&legacy).unwrap()[0]["targets"], json!(["main"]));
    }

    fn document() -> Value {
        let mut nodes = Vec::new();
        for (id, kind, event_id, config) in [
            ("initialize", "event", Some("event-initialize"), json!({"eventId":"event-initialize"})),
            ("register", "register_control", None, json!({"control":{"id":"start","label":"Start","icon":"play","eventId":"event-start"}})),
            ("start", "event", Some("event-start"), json!({"eventId":"event-start"})),
            ("pipeline", "start_pipeline", None, json!({"outputNodeId":"write"})),
            ("screen", "screen", None, json!({})),
            ("region", "region", None, json!({})),
            ("encode", "encode", None, json!({})),
            ("path", "path", None, json!({})),
            ("write", "write", None, json!({})),
        ] {
            let mut data = json!({"kind":kind,"label":id,"config":config});
            if event_id.is_some() { data["config"]["eventId"] = json!(event_id); }
            nodes.push(json!({"id":id,"type":kind,"data":data,"position":{"x":0,"y":0}}));
        }
        let edges = [
            ("initialize", "register", "flow", "flow"),
            ("start", "pipeline", "flow", "flow"),
            ("screen", "encode", "frames", "frames"),
            ("region", "screen", "region", "region"),
            ("encode", "write", "video", "video"),
            ("path", "write", "path", "path"),
        ].iter().enumerate().map(|(index, (source, target, from, to))| json!({
            "id":format!("e{index}"),"source":source,"sourceHandle":format!("out:{from}"),"target":target,"targetHandle":format!("in:{to}")
        })).collect::<Vec<_>>();
        json!({"schemaVersion":1,"id":"test","name":"Test","supported":true,"nodes":nodes,"edges":edges})
    }

    #[test]
    fn value_catalog_has_make_nodes_for_each_primitive_type() {
        let catalog = node_catalog();
        for (kind, value_type) in [
            ("make_boolean", "boolean"), ("make_byte", "byte"), ("make_integer", "integer"),
            ("make_integer64", "integer64"), ("make_float", "float"), ("make_double", "double"),
            ("make_name", "name"), ("make_string", "string"), ("make_text", "text"),
        ] {
            let definition = catalog.iter().find(|definition| definition.kind == kind).unwrap();
            assert_eq!(definition.outputs[0].value_type, value_type);
            assert_eq!(definition.outputs[0].id, "value");
        }
    }

    #[test]
    fn primitive_make_nodes_evaluate_values_and_validate_byte_range() {
        let mut doc = document();
        let cases = [
            ("bool", "make_boolean", json!(true)), ("byte", "make_byte", json!(255)),
            ("int", "make_integer", json!(-7)), ("int64", "make_integer64", json!(2147483648_i64)),
            ("float", "make_float", json!(1.25)), ("double", "make_double", json!(2.5)),
            ("name", "make_name", json!("NodeName")), ("string", "make_string", json!("value")),
            ("text", "make_text", json!("Visible text")),
        ];
        for (id, kind, value) in cases.iter().cloned() {
            doc["nodes"].as_array_mut().unwrap().push(json!({
                "id":id,"type":kind,"position":{"x":0,"y":0},
                "data":{"kind":kind,"label":kind,"config":{"value":value}}
            }));
        }
        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        for (id, _, expected) in &cases {
            assert_eq!(evaluate_value(&doc, id, &mut HashSet::new(), 0).unwrap(), *expected);
        }
        doc["nodes"][10]["data"]["config"]["value"] = json!(256);
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("invalid typed value")));
    }

    #[test]
    fn exposed_make_value_inputs_keep_their_unreal_type() {
        let mut doc = document();
        doc["nodes"].as_array_mut().unwrap().extend([
            json!({"id":"byte-target","type":"make_byte","position":{"x":0,"y":0},"data":{"kind":"make_byte","label":"Byte","config":{"value":0,"exposedInputs":["value"]}}}),
            json!({"id":"integer-source","type":"make_integer","position":{"x":0,"y":0},"data":{"kind":"make_integer","label":"Integer","config":{"value":12}}}),
        ]);
        doc["edges"].as_array_mut().unwrap().push(json!({"id":"typed-input","source":"integer-source","sourceHandle":"out:value","target":"byte-target","targetHandle":"in:param:value"}));
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("incompatible types")));

        let source = doc["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node["id"] == "integer-source").unwrap();
        source["type"] = json!("make_byte");
        source["data"]["kind"] = json!("make_byte");
        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        assert_eq!(evaluate_value(&doc, "byte-target", &mut HashSet::new(), 0).unwrap(), json!(12));
    }

    #[test]
    fn exposed_node_parameters_are_overridden_by_typed_inputs() {
        let mut doc = document();
        doc["nodes"][1]["data"]["config"]["control"]["order"] = json!(0);
        doc["nodes"][1]["data"]["config"]["exposedInputs"] = json!(["control.order"]);
        doc["nodes"].as_array_mut().unwrap().push(json!({
            "id":"make-order","type":"make_integer","position":{"x":0,"y":0},
            "data":{"kind":"make_integer","label":"Make Integer","config":{"value":7}}
        }));
        doc["edges"].as_array_mut().unwrap().push(json!({
            "id":"order-input","source":"make-order","sourceHandle":"out:value",
            "target":"register","targetHandle":"in:param:control.order"
        }));

        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        assert_eq!(execute_initialization(&doc).unwrap()[0]["order"], 7);

        doc["nodes"][9]["data"]["kind"] = json!("make_string");
        doc["nodes"][9]["type"] = json!("make_string");
        doc["nodes"][9]["data"]["config"]["value"] = json!("wrong type");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("incompatible types")));
    }

    #[test]
    fn registry_graph_is_valid_and_data_streams_are_checked_separately() {
        let doc = document();
        assert!(validate_document(&doc, true).is_empty(), "{:?}", validate_document(&doc, true));
        let mut disconnected = doc.clone();
        disconnected["edges"].as_array_mut().unwrap().retain(|edge| edge["id"] != "e2");
        assert!(validate_document(&disconnected, true).iter().any(|error| error.contains("screen source")));
        assert!(validate_document(&disconnected, false).is_empty());
    }

    #[test]
    fn recording_plan_rejects_audio_fanout_and_invalid_parameters() {
        let mut doc = document();
        let plan = recording_plan(&doc, Some("write")).unwrap();
        assert_eq!((plan.fps,plan.bitrate), (60,20_000_000));
        assert!(!plan.software);
        doc["nodes"][6]["data"]["config"] = json!({"encodingMode":"Software","fps":30,"resolution":"1920 × 1080","bitrate":"12.5"});
        let plan = recording_plan(&doc, Some("write")).unwrap();
        assert!(plan.software); assert_eq!((plan.output_width,plan.fps,plan.bitrate), (1920,30,12_500_000));
        doc["nodes"][6]["data"]["config"]["fps"] = json!(0);
        assert!(recording_plan(&doc, Some("write")).is_err());
        doc["nodes"][6]["data"]["config"]["fps"] = json!(60);
        doc["edges"].as_array_mut().unwrap().push(json!({"source":"region","sourceHandle":"out:audio","target":"encode","targetHandle":"in:audio"}));
        assert!(recording_plan(&doc, Some("write")).unwrap_err().contains("Audio"));
        doc["edges"].as_array_mut().unwrap().pop();
        doc["edges"].as_array_mut().unwrap().push(json!({"source":"screen","sourceHandle":"out:frames","target":"another-encoder","targetHandle":"in:frames"}));
        assert!(recording_plan(&doc, Some("write")).unwrap_err().contains("one source"));
    }

    #[test]
    fn recording_plan_resolves_exposed_parameters_and_preserves_legacy_regions() {
        let mut doc = document();
        doc["nodes"][5]["data"]["config"] = json!({"display":"Display 1","width":897,"height":360,"x":0,"y":0});
        assert!(!recording_plan(&doc, Some("write")).unwrap().full_display);
        doc["nodes"][6]["data"]["config"] = json!({"fps":60,"exposedInputs":["fps"]});
        doc["nodes"].as_array_mut().unwrap().push(json!({"id":"custom-fps","type":"make_integer","data":{"kind":"make_integer","config":{"value":30}}}));
        doc["edges"].as_array_mut().unwrap().push(json!({"source":"custom-fps","sourceHandle":"out:value","target":"encode","targetHandle":"in:param:fps"}));
        assert_eq!(recording_plan(&doc,Some("write")).unwrap().fps,30);
        doc["nodes"][7]["data"]["config"] = json!({"filename":"../existing.mp4","directory":"C:/Recordings"});
        assert!(recording_plan(&doc,Some("write")).is_err());
    }

    #[test]
    fn invalid_cycles_are_rejected_before_resolving_media_parameters() {
        let mut doc = document();
        for id in ["a", "b"] {
            doc["nodes"].as_array_mut().unwrap().push(json!({"id":id,"type":"make_integer","data":{"kind":"make_integer","config":{"value":60,"exposedInputs":["value"]}}}));
        }
        doc["nodes"][6]["data"]["config"] = json!({"fps":60,"exposedInputs":["fps"]});
        for (source,target,input) in [("a","b","value"),("b","a","value"),("a","encode","fps")] {
            doc["edges"].as_array_mut().unwrap().push(json!({"id":format!("{source}-{target}"),"source":source,"sourceHandle":"out:value","target":target,"targetHandle":format!("in:param:{input}")}));
        }
        assert!(validate_document(&doc, true).iter().any(|error| error.contains("cycle")));
    }

    #[test]
    fn malformed_connections_cycles_and_control_references_are_rejected() {
        let mut doc = document();
        doc["edges"].as_array_mut().unwrap().push(json!({"id":"bad","source":"start","sourceHandle":"out:nope","target":"pipeline","targetHandle":"in:flow"}));
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("invalid output")));
        doc["nodes"][1]["data"]["config"]["control"]["eventId"] = json!("missing");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("references missing Event")));
        doc["nodes"][1]["type"] = json!("log");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("visual type")));
        doc["nodes"][1]["data"]["config"]["control"]["order"] = json!(1.5);
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("order must be an integer")));
    }

    #[test]
    fn initialization_sorts_controls_by_order_and_keeps_registration_order_for_ties() {
        let mut doc = document();
        doc["nodes"][1]["data"]["config"]["control"]["order"] = json!(2);
        doc["nodes"].as_array_mut().unwrap().push(json!({
            "id":"register-first","type":"register_control","position":{"x":0,"y":0},
            "data":{"kind":"register_control","label":"Register First","config":{"control":{"id":"first","label":"First","icon":"play","eventId":"event-start","order":0,"enabled":true}}}
        }));
        doc["nodes"].as_array_mut().unwrap().push(json!({
            "id":"register-tie","type":"register_control","position":{"x":0,"y":0},
            "data":{"kind":"register_control","label":"Register Tie","config":{"control":{"id":"tie","label":"Tie","icon":"play","eventId":"event-start","order":2,"enabled":true}}}
        }));
        doc["edges"].as_array_mut().unwrap().push(json!({"id":"register-next","source":"register","sourceHandle":"out:flow","target":"register-first","targetHandle":"in:flow"}));
        doc["edges"].as_array_mut().unwrap().push(json!({"id":"register-tie-next","source":"register-first","sourceHandle":"out:flow","target":"register-tie","targetHandle":"in:flow"}));

        let controls = execute_initialization(&doc).unwrap();
        assert_eq!(controls.iter().map(|control| control["id"].as_str().unwrap()).collect::<Vec<_>>(), ["first", "start", "tie"]);
        assert_eq!(controls.iter().map(|control| control["order"].as_i64().unwrap()).collect::<Vec<_>>(), [0, 2, 2]);
    }

    #[test]
    fn menu_registration_nodes_build_hierarchy_from_paths() {
        let mut doc = document();
        doc["nodes"].as_array_mut().unwrap().extend([
            json!({"id":"menu-start","type":"register_menu","position":{"x":0,"y":0},"data":{"kind":"register_menu","label":"Register Start Menu","config":{"controlId":"start","path":"Start","icon":"play","eventId":"event-start"}}}),
            json!({"id":"menu-delayed","type":"register_menu","position":{"x":0,"y":0},"data":{"kind":"register_menu","label":"Register Delayed Start Menu","config":{"controlId":"start","path":"Start/Start after 3s","icon":"clock-3","eventId":"event-start"}}}),
        ]);
        doc["edges"].as_array_mut().unwrap().extend([
            json!({"id":"register-menu-start","source":"register","sourceHandle":"out:flow","target":"menu-start","targetHandle":"in:flow"}),
            json!({"id":"register-menu-delayed","source":"menu-start","sourceHandle":"out:flow","target":"menu-delayed","targetHandle":"in:flow"}),
        ]);

        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        let controls = execute_initialization(&doc).unwrap();
        assert_eq!(controls[0]["menu"][0]["id"], "Start");
        assert_eq!(controls[0]["menu"][0]["children"][0]["id"], "Start/Start after 3s");

        doc["nodes"][10]["data"]["config"]["path"] = json!("Missing parent/Child");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("missing parent")));
    }

    #[test]
    fn branch_uses_connected_values_to_choose_an_execution_path() {
        let mut doc = document();
        let nodes = doc["nodes"].as_array_mut().unwrap();
        nodes.push(json!({"id":"branch","type":"branch","data":{"kind":"branch","label":"Branch","config":{"condition":false}},"position":{"x":0,"y":0}}));
        nodes.push(json!({"id":"left","type":"constant","data":{"kind":"constant","label":"Left","config":{"value":"screen"}},"position":{"x":0,"y":0}}));
        nodes.push(json!({"id":"right","type":"constant","data":{"kind":"constant","label":"Right","config":{"value":"screen"}},"position":{"x":0,"y":0}}));
        nodes.push(json!({"id":"compare","type":"compare","data":{"kind":"compare","label":"Compare","config":{"operator":"equal"}},"position":{"x":0,"y":0}}));
        doc["edges"].as_array_mut().unwrap().iter_mut().find(|edge| edge["id"] == "e1").unwrap()["target"] = json!("branch");
        let edges = doc["edges"].as_array_mut().unwrap();
        edges.extend([
            json!({"id":"branch-pipeline","source":"branch","sourceHandle":"out:true","target":"pipeline","targetHandle":"in:flow"}),
            json!({"id":"left-compare","source":"left","sourceHandle":"out:value","target":"compare","targetHandle":"in:left"}),
            json!({"id":"right-compare","source":"right","sourceHandle":"out:value","target":"compare","targetHandle":"in:right"}),
            json!({"id":"compare-branch","source":"compare","sourceHandle":"out:condition","target":"branch","targetHandle":"in:condition"}),
        ]);
        assert!(validate_document(&doc, true).is_empty(), "{:?}", validate_document(&doc, true));
        assert_eq!(branch_output(&doc, &doc["nodes"][9]).unwrap(), "out:true");
        assert!(execution_path(&doc, "event-start").unwrap().iter().any(|node| node_kind(node) == "start_pipeline"));
        doc["nodes"][11]["data"]["config"]["value"] = json!("audio");
        assert_eq!(branch_output(&doc, &doc["nodes"][9]).unwrap(), "out:false");
        assert!(!execution_path(&doc, "event-start").unwrap().iter().any(|node| node_kind(node) == "start_pipeline"));
    }

    #[test]
    fn operation_preview_cannot_run() {
        let mut doc = document();
        doc["supported"] = json!(false);
        assert!(validate_document(&doc, true).iter().any(|error| error.contains("preview")));
    }

    #[test]
    fn activation_does_not_reset_or_replace_a_running_blueprint() {
        let runtime = WorkflowRuntime::default();
        let doc = document();
        runtime.activate(doc.clone()).unwrap();
        runtime.state.lock().unwrap().status = "recording";
        assert!(runtime.activate(doc.clone()).is_ok());
        assert_eq!(runtime.snapshot().status, "recording");
        let mut changed = doc;
        changed["name"] = json!("Changed");
        assert!(runtime.activate(changed).is_err());
        assert_eq!(runtime.snapshot().status, "recording");
    }

    #[test]
    fn checked_in_blueprints_match_the_runtime_schema() {
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../blueprints/builtin");
        for name in ["screen-recording", "operation-recording"] {
            let document: Value = serde_json::from_slice(&std::fs::read(directory.join(format!("{name}.nodrec.json"))).unwrap()).unwrap();
            assert!(validate_document(&document, false).is_empty(), "{name}: {:?}", validate_document(&document, false));
            if name == "screen-recording" {
                assert!(validate_document(&document, true).is_empty());
                assert_eq!(execute_initialization(&document).unwrap().len(), 6);
            } else {
                assert!(validate_document(&document, true).iter().any(|error| error.contains("preview")));
                assert_eq!(execute_initialization(&document).unwrap().len(), 1);
            }
        }
    }
}
