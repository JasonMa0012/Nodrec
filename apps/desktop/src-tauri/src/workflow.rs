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
    pub provider: Option<&'static str>,
    pub actions: Vec<&'static str>,
    pub kind: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    pub inputs: Vec<NodePort>,
    pub outputs: Vec<NodePort>,
    pub input_parameters: Vec<&'static str>,
    pub default_config: Value,
    pub choices: Value,
}

fn port(id: &'static str, label: &'static str, value_type: &'static str) -> NodePort {
    NodePort { id, label, value_type }
}

fn node_type(kind: &'static str, label: &'static str, category: &'static str, inputs: Vec<NodePort>, outputs: Vec<NodePort>, input_parameters: Vec<&'static str>, default_config: Value) -> NodeType {
    NodeType { kind, label, category, inputs, outputs, input_parameters, default_config,
        provider: if kind == "encode_media_foundation" { Some("media_foundation") } else { None },
        actions: match kind { "screen" => vec!["record"], "select_region" => vec!["select"], _ => vec![] },
        choices: if kind == "encode_media_foundation" {
            json!({"codec":["H.264"],"resolution":["Source Size","1920 × 1080","2560 × 1440"],"encodingMode":["Hardware Auto","Software"]})
        } else if kind == "screen" { json!({"region.mode":["Full Display","Rectangle"]}) } else if kind == "region" { json!({"mode":["Full Display","Rectangle"]}) } else { json!({}) },
    }
}

pub fn node_catalog() -> Vec<NodeType> {
    vec![
        node_type("define_value", "Define Value", "Values", vec![port("value", "Value", "value")], vec![port("value", "Value", "value")], vec![], json!({"name":"Value"})),
        node_type("read_value", "Read Value", "Values", vec![], vec![port("value", "Value", "value")], vec![], json!({"definitionId":""})),
        node_type("select_region", "Select Region", "Capture", vec![port("initialRegion", "Initial Region", "region")], vec![port("region", "Region", "region")], vec!["display"], json!({"toolId":"capture-region","display":"Display 1","initialRegion":null})),
        node_type("get_selected_region", "Get Selected Region", "Values", vec![port("selected", "Selected Region", "region"), port("fallback", "Manual / Full Display", "region")], vec![port("region", "Region", "region")], vec!["mode"], json!({"toolId":"capture-region","mode":"Selected Region"})),
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
        node_type("region", "Screen Region", "Values", vec![], vec![port("region", "Region", "region")], vec!["display", "mode", "x", "y", "width", "height"], json!({"display":"Display 1","mode":"Full Display","x":0,"y":0,"width":897,"height":360})),
        node_type("path", "Output Path", "Values", vec![], vec![port("path", "Path", "path")], vec!["directory", "filename"], json!({"directory":"C:/Recordings","filename":"{blueprint}_{timestamp}.mp4"})),
        node_type("screen", "Capture Screen", "Streams", vec![port("region", "Region", "region")], vec![port("frames", "Frames", "video_frames")], vec!["cursor", "fps", "startDelaySeconds"], json!({"cursor":true,"fps":60,"startDelaySeconds":0,"region":{"display":"Display 1","mode":"Full Display","x":0,"y":0,"width":897,"height":360}})),
        node_type("audio", "Capture Audio", "Streams", vec![], vec![port("audio", "Audio", "audio_samples")], vec![], json!({})),
        node_type("encode_media_foundation", "Media Foundation Encode", "Streams", vec![port("frames", "Frames", "video_frames"), port("audio", "Audio (not supported yet)", "audio_samples")], vec![port("video", "Video", "encoded_video")], vec!["codec", "resolution", "bitrate", "encodingMode"], json!({"codec":"H.264","resolution":"Source Size","bitrate":"20","encodingMode":"Hardware Auto"})),
        node_type("write", "Write MP4", "Streams", vec![port("video", "Video", "encoded_video"), port("path", "Path", "path")], vec![], vec![], json!({"path":{"directory":"C:/Recordings","filename":"{blueprint}_{timestamp}.mp4"}})),
    ]
}

pub use crate::logging::LogEntry as RuntimeLog;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub node_errors: Vec<NodeError>,
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
pub struct NodeError {
    pub graph_id: String,
    pub node_id: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activation {
    pub controls: Vec<Value>,
    pub diagnostics: Vec<String>,
}

#[derive(Default)]
struct RuntimeState {
    run_graph: String,
    run_source: String,
    output_nodes: HashMap<String, (String, String)>,
    document: Option<Value>,
    blueprint_id: Option<String>,
    run_id: Option<String>,
    status: &'static str,
    generation: u64,
    busy_generation: Option<u64>,
    frame_count: u64,
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
        let mut definitions = HashMap::new();
        if let Some(document) = &state.document {
            for graph in document["graphs"].as_array().into_iter().flatten() {
                let Ok(scoped) = action_document(document, graph["id"].as_str().unwrap_or_default()) else { continue; };
                for node in nodes(&scoped).iter().filter(|node| node_kind(node) == "select_region") {
                    if let Ok(config) = resolved_node_config(&scoped, node) {
                        if let Some(id) = config["toolId"].as_str() { definitions.insert(id.to_string(), config.clone()); }
                    }
                }
            }
        }
        definitions
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
        state.output_nodes.clear();
        state.run_graph.clear();
        state.run_source.clear();
        state.status = "ready";
        state.controls.clear();
        let mut registry_errors = Vec::new();
        validate_control_registry(&document, &mut registry_errors);
        if registry_errors.is_empty() && document["schemaVersion"] == 2 {
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
        let node_errors = recording_node_errors(&state);
        RuntimeSnapshot {
            node_errors: node_errors.clone(),
            blueprint_id: state.blueprint_id.clone(),
            run_id: state.run_id.clone(),
            status: state.status.to_string(),
            frame_count: state.frame_count,
            displays: state.controls.iter().filter(|c| c["kind"] == "display").cloned().collect(),
            controls: state.controls.iter().filter(|c| c["kind"] != "display").cloned().map(|mut control| {
                if let Some(error) = node_errors.iter().find(|error| control["binding"]["graphId"] == error.graph_id && control["binding"]["nodeId"] == error.node_id) { control["error"] = json!(error.message); }
                control
            }).collect(),
            logs: state.logs.iter().cloned().collect(),
            error: state.error.clone(),
            recording: state.recording.clone(),
        }
    }

    pub fn dispatch_node(&self, app: AppHandle, graph_id: String, id: String, action: String) -> Result<RuntimeSnapshot, String> {
        let (document, generation) = {
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            let mut document = action_document(state.document.as_ref().ok_or("No blueprint is active")?, &graph_id)?;
            if action == "start" { document["_runTimestamp"] = json!(now_nanos().to_string()); }
            if document["supported"] == false { return Err("This blueprint is a preview".into()); }
            let node = nodes(&document).iter().find(|node| node_id(node) == id).ok_or("Action node was not found")?;
            if node["data"]["enabled"] == false { return Err("Action node is disabled".into()); }
            if node_kind(node) == "select_region" && action == "select" {
                if !matches!(state.status, "ready" | "failed") || state.busy_generation.is_some() { return Err("Stop recording before selecting a region".into()); }
                let config = resolved_node_config(&self.evaluation_document(&document), node)?;
                let blueprint = document["id"].as_str().unwrap_or_default().to_string();
                drop(state);
                self.tools.open(&app, &blueprint, &config)?;
                return Ok(self.snapshot());
            }
            if !node_action_allowed(node_kind(node), &action, state.status) {
                return Err("Action is not supported by this node".into());
            }
            if state.busy_generation.is_some() && action != "stop" { return Err("Another action is still running".into()); }
            match (action.as_str(), state.status) {
                ("start", "ready" | "failed") => {
                    let outputs = match compile_recording_outputs(&self.evaluation_document(&document), &id) {
                        Ok(outputs) => outputs,
                        Err(error) => {
                            state.run_graph = graph_id.clone(); state.run_source = id.clone(); state.output_nodes.clear();
                            state.recording = None; state.error = Some(error.clone()); state.status = "failed";
                            drop(state);
                            self.emit_status(&app);
                            return Err(error);
                        }
                    };
                    state.run_graph = graph_id.clone();
                    state.run_source = id.clone();
                    state.output_nodes = outputs.iter().map(|output| (output.plan.path.to_string_lossy().into_owned(),(output.node_id.clone(),output.encoder_id.clone()))).collect();
                    state.status = "starting";
                    state.run_id = Some(format!("run-{}", now_nanos()));
                    state.error = None;
                    state.recording = None;
                    state.frame_count = 0;
                }
                ("pause", "recording") | ("resume", "paused") => {}
                ("stop", "starting" | "recording" | "paused" | "failed") => state.status = "stopping",
                _ => return Err("Action is not available in the current recording state".into()),
            }
            state.generation = state.generation.wrapping_add(1);
            state.busy_generation = Some(state.generation);
            (document, state.generation)
        };
        self.emit_status(&app);
        let runtime = self.clone();
        thread::spawn(move || {
            let result = match action.as_str() {
                "start" => runtime.start_pipeline(&app, &document, &id, generation),
                "pause" => runtime.set_pipeline_state(&app, generation, "recording", "paused", "Recording paused"),
                "resume" => runtime.set_pipeline_state(&app, generation, "paused", "recording", "Recording resumed"),
                "stop" => runtime.stop_pipeline(&app, generation),
                _ => unreachable!(),
            };
            if let Err(error) = result { runtime.fail(&app, generation, error); return; }
            let mut state = runtime.state.lock().unwrap_or_else(|error| error.into_inner());
            if state.generation == generation { state.busy_generation = None; if state.status == "stopping" { state.status = "ready"; state.run_id = None; } }
            drop(state);
            runtime.emit_status(&app);
        });
        Ok(self.snapshot())
    }

    pub fn stop_for_region_close(&self, app: AppHandle) -> Result<(), String> {
        let source = {
            let state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            matches!(state.status, "starting" | "recording" | "paused")
                .then(|| (state.run_graph.clone(), state.run_source.clone()))
        };
        if let Some((graph, source)) = source { self.dispatch_node(app, graph, source, "stop".into())?; }
        Ok(())
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

    fn start_pipeline(&self, app: &AppHandle, document: &Value, source: &str, generation: u64) -> Result<(), String> {
        let evaluated = self.evaluation_document(document);
        let (plan, groups) = {
            let outputs = compile_recording_outputs(&evaluated, source)?;
            let plan = outputs[0].plan.clone();
            let mut groups: Vec<(String,RecordingPlan,Vec<std::path::PathBuf>)> = Vec::new();
            for output in outputs {
                if let Some((_,_,paths)) = groups.iter_mut().find(|(id,_,_)| id == &output.encoder_id) { paths.push(output.plan.path); }
                else { groups.push((output.encoder_id,output.plan.clone(),vec![output.plan.path])); }
            }
            (plan, groups.into_iter().map(|(_,plan,paths)|(plan,paths)).collect())
        };
        let deadline = std::time::Instant::now() + recording_delay(&evaluated, source)?;
        while std::time::Instant::now() < deadline {
            if !self.is_current(generation) { return Ok(()); }
            thread::sleep(Duration::from_millis(10));
        }
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
            let session = RecordingSession::launch_graph(plan, groups);
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
        if let Some(mut session) = session {
            let result = session.finish();
            let stats = session.stats();
            let mut state = self.state.lock().map_err(|_| "Workflow state is unavailable".to_string())?;
            state.frame_count = stats.encoded_frames;
            state.recording = Some(stats);
            result?;
        }
        let result = self.snapshot().recording.map(|stats| format!("MP4 finalized and closed: {} ({} ms)", stats.output_path, stats.stop_ms.unwrap_or(0)))
            .unwrap_or_else(|| "MP4 finalized: no active recording; pending start cancelled".into());
        self.log(app, &result)?;
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
        let log = crate::logging::contextual(if message.starts_with("Workflow failed:") { "error" } else { "info" }, "workflow", state.blueprint_id.clone(), state.run_id.clone(), message);
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

fn node_action_allowed(kind: &str, action: &str, status: &str) -> bool {
    kind == "screen" && matches!((action, status),
        ("start", "ready" | "failed") | ("pause", "recording") | ("resume", "paused") |
        ("stop", "starting" | "recording" | "paused" | "failed"))
}

fn node_id(node: &Value) -> &str {
    node.get("id").and_then(Value::as_str).unwrap_or_default()
}

fn edges(document: &Value) -> &[Value] {
    document["graphs"][0].get("edges").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

fn nodes(document: &Value) -> &[Value] {
    document["graphs"][0].get("nodes").and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
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

fn config_input_port_id(_kind: &str, path: &str) -> String { format!("param:{path}") }

fn node_port_type(document: &Value, catalog: &[NodeType], node: &Value, handle: &str, direction: &str) -> Option<&'static str> {
    let kind = node_kind(node);
    if let Some(port) = find_port(catalog, kind, handle, direction) {
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
    if !node_type.input_parameters.contains(&path) { return None; }
    if path == "value" {
        if let Some(value_type) = make_value_type(kind) { return Some(value_type); }
    }
    let schema = if kind == "constant" && path == "value" { node_config(node) } else { &node_type.default_config };
    config_value_type(config_path_value(schema, path)?)
}

fn compatible_port_types(source: &str, target: &str) -> bool {
    source == target || source == "value" || target == "value"
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
    if matches!(kind, "region" | "screen" | "encode_media_foundation" | "path" | "write") {
        let supplied = config.as_object().cloned().unwrap_or_default();
        config = node_type.default_config.clone();
        config.as_object_mut().unwrap().extend(supplied.clone());
        for field in ["region", "path"] {
            if let (Some(default), Some(local)) = (node_type.default_config[field].as_object(), supplied.get(field).and_then(Value::as_object)) {
                let mut value = default.clone();
                value.extend(local.clone());
                config[field] = Value::Object(value);
            }
        }
    }
    if kind == "select_region" {
        if let Some(region) = input_value(document, node_id(node), "initialRegion", &mut HashSet::new(), 0)? { config["initialRegion"] = region; }
    }
    for path in &node_type.input_parameters {
        let input = config_input_port_id(kind, &path);
        if let Some(value) = input_value(document, node_id(node), &input, &mut HashSet::new(), 0)? {
            set_config_path(&mut config, &path, value)?;
        }
    }
    Ok(config)
}

fn recording_node_errors(state: &RuntimeState) -> Vec<NodeError> {
    let mut messages: HashMap<String, String> = HashMap::new();
    let mut output_errors = Vec::new();
    if let Some(stats) = &state.recording {
        for output in &stats.outputs {
            if let Some(error) = &output.error {
                output_errors.push(format!("{}: {error}", output.path));
                if let Some((writer, encoder)) = state.output_nodes.get(&output.path) {
                    messages.insert(writer.clone(), error.clone());
                    if let Some(error) = &output.encoder_error { messages.insert(encoder.clone(), error.clone()); }
                }
            }
        }
    }
    if !state.run_source.is_empty() {
        if let Some(error) = state.error.clone().or_else(|| (!output_errors.is_empty()).then(|| output_errors.join("; "))) {
            messages.insert(state.run_source.clone(), error);
        }
    }
    let mut errors: Vec<_> = messages.into_iter().map(|(node_id,message)| NodeError{graph_id:state.run_graph.clone(),node_id,message}).collect();
    errors.sort_by(|a,b| a.node_id.cmp(&b.node_id));
    errors
}

fn action_document(document: &Value, graph_id: &str) -> Result<Value, String> {
    let mut scoped = document.clone();
    let graphs = scoped["graphs"].as_array_mut().ok_or("Blueprint graphs must be an array")?;
    let index = graphs.iter().position(|graph| graph["id"] == graph_id).ok_or("Recording graph was not found")?;
    graphs.swap(0, index);
    Ok(scoped)
}

pub fn validate_document(document: &Value, for_run: bool) -> Vec<String> {
    let Some(graphs) = document["graphs"].as_array().filter(|graphs| !graphs.is_empty()) else {
        return vec!["Blueprint graphs must be a nonempty array".into()];
    };
    let mut ids = HashSet::new();
    let mut errors = Vec::new();
    for graph in graphs {
        let id = graph["id"].as_str().unwrap_or_default();
        if id.is_empty() || !ids.insert(id) {
            errors.push(format!("Graph ID '{id}' is empty or duplicated"));
            continue;
        }
        if let Ok(scoped) = action_document(document, id) {
            errors.extend(validate_graph_document(&scoped, for_run, true));
        }
    }
    errors.sort();
    errors.dedup();
    errors
}

fn validate_graph_document(document: &Value, for_run: bool, check_ui: bool) -> Vec<String> {
    let mut errors = Vec::new();
    if ["eventFolders","events","functionFolders","functions"].iter().any(|key| document.get(key).is_some()) { errors.push("Unsupported blueprint schema: legacy execution library fields".into()); }
    if document.get("schemaVersion").and_then(Value::as_u64) != Some(crate::storage::SCHEMA_VERSION) {
        errors.push("Unsupported blueprint schema version".into());
    }
    if for_run && document.get("supported").and_then(Value::as_bool) == Some(false) {
        errors.push("This blueprint is a preview and cannot run yet".into());
    }
    let Some(node_values) = document["graphs"][0].get("nodes").and_then(Value::as_array) else {
        errors.push("Blueprint nodes must be an array".into());
        return errors;
    };
    let Some(edge_values) = document["graphs"][0].get("edges").and_then(Value::as_array) else {
        errors.push("Blueprint edges must be an array".into());
        return errors;
    };
    if node_values.len() > 2048 || edge_values.len() > 8192 {
        errors.push("Blueprint graph exceeds the supported node or connection limit".into());
        return errors;
    }
    let catalog = node_catalog();
    let mut by_id = HashMap::new();
    let mut edge_ids = HashSet::new();
    for node in node_values {
        let id = node_id(node);
        if id.is_empty() || by_id.insert(id, node).is_some() { errors.push(format!("Node ID '{id}' is empty or duplicated")); continue; }
        let kind = node_kind(node);
        if node["data"].get("enabled").is_some_and(|enabled| !enabled.is_boolean()) {
            errors.push(format!("Node '{id}' enabled must be a boolean"));
        }
        let node_type = catalog.iter().find(|item| item.kind == kind);
        if node_type.is_none() { errors.push(format!("Unknown node type '{kind}'")); }
        if node.get("type").and_then(Value::as_str) != Some(kind) { errors.push(format!("Node '{id}' visual type does not match its registered kind")); }
    }
    let mut incoming = HashSet::new();
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
        adjacency.entry(source).or_default().push(target);
    }
    let mut value_names = HashSet::new();
    for node in node_values.iter().filter(|node| node_kind(node) == "define_value") {
        let name = node_config(node)["name"].as_str().unwrap_or_default().trim();
        if name.is_empty() || !value_names.insert(name) { errors.push(format!("Named value '{name}' is empty or defined more than once")); }
    }
    for node in node_values.iter().filter(|node| node_kind(node) == "read_value") {
        let definition = node_config(node)["definitionId"].as_str().unwrap_or_default();
        if by_id.get(definition).is_none_or(|value| node_kind(value) != "define_value") {
            errors.push(format!("Read Value '{}' references missing definition '{definition}'", node_id(node)));
        } else {
            adjacency.entry(definition).or_default().push(node_id(node));
        }
    }
    if has_cycle(&by_id, &adjacency) { errors.push("Workflow graph contains a cycle".into()); }
    if check_ui { validate_control_registry(document, &mut errors); }
    for node in node_values.iter().filter(|node| node_kind(node) == "get_selected_region") {
        let tool = node_config(node)["toolId"].as_str().unwrap_or_default();
        let exists = document["graphs"].as_array().into_iter().flatten().flat_map(|graph| graph["nodes"].as_array().into_iter().flatten()).any(|node| node_kind(node) == "select_region" && node_config(node)["toolId"] == tool);
        let wired = edges(document).iter().any(|edge| edge["target"] == node_id(node) && edge["targetHandle"] == "in:selected");
        if check_ui && !wired && !exists { errors.push("Get Selected Region references a missing tool".into()); }
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
        let mut validation = document.clone();
        validation["_validateRegionStructure"] = json!(true);
        for source in node_values.iter().filter(|node| node_kind(node) == "screen" && node["data"]["enabled"] != false) {
            if let Err(error) = compile_recording_outputs(&validation, node_id(source)) { errors.push(error); }
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
    if node_kind(node) == "get_selected_region" {
        if let Some(region) = input_value(document, node_id(node), "selected", &mut HashSet::new(), 0)? { return Ok(region); }
    }
    let tool = config["toolId"].as_str().unwrap_or_default();
    if let Some(region) = document.get("_selectedRegions").and_then(|r| r.get(tool)) { return Ok(region.clone()); }
    if document["_validateRegionStructure"] == true {
        return Ok(json!({"display":"Display 1","mode":"Rectangle","x":0,"y":0,"width":16,"height":16}));
    }
    Err(format!("Select a region with tool '{tool}' before starting"))
}

fn validate_control_registry(document: &Value, errors: &mut Vec<String>) {
    let mut graph_ids = HashSet::new();
    if document["graphs"].as_array().is_none_or(|graphs| graphs.is_empty() || graphs.iter().any(|graph| graph["id"].as_str().is_none_or(|id| id.is_empty() || !graph_ids.insert(id)))) {
        errors.push("Blueprint graph IDs must be present and unique".into());
    }
    if ["eventFolders","events","functionFolders","functions"].iter().any(|key| document.get(key).is_some()) { errors.push("Unsupported legacy execution library fields".into()); }
    validate_tools(document, errors);
    if let Some(controls) = document.get("controls") {
        if let Some(controls) = controls.as_array() {
            let mut ids = HashSet::new();
            for control in controls {
                let id = control["id"].as_str().unwrap_or_default();
                if id.is_empty() || !ids.insert(id) { errors.push(format!("Control ID '{id}' is empty or duplicated")); }
                if control["label"].as_str().is_none_or(str::is_empty) { errors.push(format!("Control '{id}' needs a label")); }
                if let Some(binding) = control.get("binding") {
                    let graph = document["graphs"].as_array().and_then(|graphs| graphs.iter().find(|graph| graph["id"] == binding["graphId"]));
                    let target = graph.and_then(|graph| graph["nodes"].as_array()).and_then(|nodes| nodes.iter().find(|node| node["id"] == binding["nodeId"]));
                    if !target.is_some_and(|node| matches!((node_kind(node), binding["action"].as_str()), ("screen", Some("record")) | ("select_region", Some("select")))) {
                        errors.push(format!("Control '{id}' has an invalid node action binding"));
                    }
                } else { errors.push(format!("Control '{id}' needs a node action binding")); }
                if !valid_icon(control["icon"].as_str().unwrap_or_default()) { errors.push(format!("Control '{id}' uses an unsupported icon")); }
                if !control["enabled"].is_boolean() { errors.push(format!("Control '{id}' needs boolean enabled")); }
            }
        } else { errors.push("Blueprint controls must be an array".into()); }
    }
}

fn validate_tools(document: &Value, errors: &mut Vec<String>) {
    let mut tools = HashSet::new();
    let all_nodes: Vec<_> = document["graphs"].as_array().into_iter().flatten().flat_map(|graph| graph["nodes"].as_array().into_iter().flatten()).collect();
    for node in all_nodes.iter().filter(|n| node_kind(n) == "select_region") {
        let id = node_config(node)["toolId"].as_str().unwrap_or_default();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') || !tools.insert(id) {
            errors.push(format!("Tool ID '{id}' is invalid or duplicated"));
        }
    }
    let mut ids = HashSet::new();
    for (kind, items) in [("controls", document.get("controls")), ("displays", document.get("displays"))] {
        if items.is_none_or(|items| !items.is_array()) { errors.push(format!("Blueprint {kind} must be an array")); }
        for item in items.and_then(Value::as_array).into_iter().flatten() {
            let id = item["id"].as_str().unwrap_or_default();
            if id.is_empty() || !ids.insert(id) { errors.push(format!("UI item ID '{id}' is empty or duplicated")); }
            if kind == "displays" && !matches!(item["source"].as_str(), Some("status" | "elapsed")) { errors.push(format!("Display '{id}' has an invalid source")); }
            if kind == "displays" {
                if let Some(binding) = item.get("binding") {
                    let node = document["graphs"].as_array().and_then(|graphs| graphs.iter().find(|graph| graph["id"] == binding["graphId"]))
                        .and_then(|graph| graph["nodes"].as_array()).and_then(|nodes| nodes.iter().find(|node| node["id"] == binding["nodeId"]));
                    if binding["action"] != "record" || node.is_none_or(|node| node_kind(node) != "screen") { errors.push(format!("Display '{id}' must bind to a screen recording node")); }
                }
            }
            if item["targets"].as_array().is_none_or(|targets| targets.iter().any(|target| target.as_str().is_none_or(|target| target != "main" && !target.strip_prefix("region:").is_some_and(|id| tools.contains(id))))) {
                errors.push(format!("UI item '{id}' has invalid targets"));
            }
        }
    }
    if let Some(orders) = document["controlOrder"].as_object() {
        let mut controls: Vec<&Value> = document["controls"].as_array().into_iter().flatten().collect();
        controls.extend(document["displays"].as_array().into_iter().flatten().filter(|display| display.get("binding").is_some()));
        for (target, order) in orders {
            if target != "main" && !target.strip_prefix("region:").is_some_and(|id| tools.contains(id)) { errors.push(format!("Control order references invalid target '{target}'")); }
            let expected: HashSet<_> = controls.iter().filter(|control| control["targets"].as_array().is_some_and(|targets| targets.iter().any(|item| item == target))).filter_map(|control| control["id"].as_str()).collect();
            let Some(order) = order.as_array() else { errors.push(format!("Control order for '{target}' must be an array")); continue; };
            let actual: HashSet<_> = order.iter().filter_map(Value::as_str).collect();
            if actual != expected || actual.len() != order.len() { errors.push(format!("Control order for '{target}' must contain each visible control exactly once")); }
        }
        for control in &controls {
            for target in control["targets"].as_array().into_iter().flatten().filter_map(Value::as_str) {
                if !orders.contains_key(target) { errors.push(format!("Missing control order for '{target}'")); }
            }
        }
    } else { errors.push("Blueprint controlOrder must be an object".into()); }

}

fn valid_icon(icon: &str) -> bool {
    matches!(icon, "circle-help" | "crop" | "monitor" | "play" | "pause" | "square" | "stop-circle" | "settings" | "video" | "folder" | "mouse-pointer-2" | "audio-lines" | "clock-3")
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

fn input_value(document: &Value, target_id: &str, input: &str, visiting: &mut HashSet<String>, depth: usize) -> Result<Option<Value>, String> {
    let edge = edges(document).iter().find(|edge| edge.get("target").and_then(Value::as_str) == Some(target_id) && edge.get("targetHandle").and_then(Value::as_str) == Some(&format!("in:{input}")));
    let Some(source) = edge.and_then(|edge| edge.get("source")).and_then(Value::as_str) else { return Ok(None); };
    evaluate_value(document, source, visiting, depth + 1).map(Some)
}

fn enabled_source<'a>(document: &'a Value, id: &str, handle: &str, visiting: &mut HashSet<String>) -> Result<(&'a Value, String), String> {
    if !visiting.insert(id.to_string()) { return Err(format!("Disabled bypass contains a cycle at '{id}'")); }
    let result = (|| {
        let node = nodes(document).iter().find(|node| node_id(node) == id).ok_or_else(|| format!("Source node '{id}' was not found"))?;
        if node["data"]["enabled"] != false { return Ok((node, handle.to_string())); }
        let catalog = node_catalog();
        let definition = catalog.iter().find(|item| item.kind == node_kind(node)).ok_or_else(|| format!("Unknown node type '{}'", node_kind(node)))?;
        let output_type = node_port_type(document, &catalog, node, handle, "out").ok_or_else(|| format!("Invalid output '{id}.{handle}'"))?;
        let outputs = definition.outputs.iter().filter(|port| node_port_type(document, &catalog, node, &format!("out:{}", port.id), "out") == Some(output_type)).count();
        let inputs: Vec<_> = definition.inputs.iter().map(|port| format!("in:{}",port.id))
            .chain(definition.input_parameters.iter().map(|path| format!("in:{}",config_input_port_id(node_kind(node),path))))
            .filter(|input| node_port_type(document, &catalog, node, input, "in") == Some(output_type)).collect();
        if outputs != 1 || inputs.len() != 1 { return Err(format!("Node disabled: '{id}' blocks this path: no unique same-type bypass")); }
        let incoming: Vec<_> = edges(document).iter().filter(|edge| edge["target"] == id && edge["targetHandle"] == inputs[0]).collect();
        if incoming.len() != 1 { return Err(format!("Node disabled: '{id}' blocks this path: bypass input needs one connection")); }
        enabled_source(document, incoming[0]["source"].as_str().unwrap_or_default(), incoming[0]["sourceHandle"].as_str().unwrap_or_default(), visiting)
    })();
    visiting.remove(id);
    result
}

fn evaluate_value(document: &Value, id: &str, visiting: &mut HashSet<String>, depth: usize) -> Result<Value, String> {
    if depth > 128 { return Err("Value evaluation exceeds 128 connected nodes".into()); }
    if !visiting.insert(id.to_string()) { return Err(format!("Value graph contains a cycle at '{id}'")); }
    let result = (|| {
        let node = nodes(document).iter().find(|node| node_id(node) == id).ok_or_else(|| format!("Value node '{id}' was not found"))?;
        if node["data"]["enabled"] == false {
            let definition = node_catalog().into_iter().find(|item| item.kind == node_kind(node)).ok_or_else(|| format!("Unknown value node '{id}'"))?;
            if definition.outputs.len() != 1 { return Err(format!("Value node disabled: '{id}' has no unique output")); }
            let (source, _) = enabled_source(document, id, &format!("out:{}", definition.outputs[0].id), &mut HashSet::new())?;
            return evaluate_value(document, node_id(source), visiting, depth + 1);
        }
        let config = resolved_node_config(document, node)?;
        match node_kind(node) {
            "define_value" => input_value(document, id, "value", visiting, depth)?.ok_or_else(|| format!("Named value '{id}' needs one input")),
            "read_value" => {
                let definition = config["definitionId"].as_str().ok_or_else(|| format!("Read Value '{id}' needs a definition"))?;
                let target = nodes(document).iter().find(|node| node_id(node) == definition && node_kind(node) == "define_value")
                    .ok_or_else(|| format!("Named value definition '{definition}' was not found"))?;
                evaluate_value(document, node_id(target), visiting, depth + 1)
            }
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

fn execute_initialization(document: &Value) -> Result<Vec<Value>, String> {
    if let Some(definitions) = document.get("controls").and_then(Value::as_array) {
        let mut controls = definitions.clone();
        if let Some(displays) = document.get("displays").and_then(Value::as_array) {
            controls.extend(displays.iter().cloned().map(|mut display| { display["kind"] = json!("display"); display }));
        }
        for (index, control) in controls.iter_mut().enumerate() {
            control["order"] = json!(index);
            let mut orders = serde_json::Map::new();
            if let Some(targets) = document.get("controlOrder").and_then(Value::as_object) {
                for (target, ids) in targets {
                    if let Some(index) = ids.as_array().and_then(|ids| ids.iter().position(|id| id == &control["id"])) { orders.insert(target.clone(), json!(index)); }
                }
            }
            control["targetOrder"] = Value::Object(orders);
        }
        return Ok(controls);
    }
    Err("Blueprint controls must be an array".into())
}

fn pipeline_source<'a>(document: &'a Value, target: &str, input: &str, kind: &str, output: &str) -> Result<&'a Value, String> {
    let incoming: Vec<_> = edges(document).iter().filter(|edge| edge["target"] == target && edge["targetHandle"] == format!("in:{input}")).collect();
    if incoming.len() != 1 { return Err(format!("Connect exactly one {kind} source to {target}.{input}")); }
    let edge = incoming[0];
    let (source, handle) = enabled_source(document, edge["source"].as_str().unwrap_or_default(), edge["sourceHandle"].as_str().unwrap_or_default(), &mut HashSet::new())?;
    if (node_kind(source) != kind && !(kind == "region" && matches!(node_kind(source), "select_region" | "get_selected_region"))) || handle != format!("out:{output}") { return Err(format!("{target}.{input} requires {kind}.{output}")); }
    Ok(source)
}

fn recording_plan(document: &Value, output_id: Option<&str>) -> Result<RecordingPlan, String> {
    let output = nodes(document).iter().find(|node| Some(node_id(node)) == output_id && node_kind(node) == "write")
        .ok_or_else(|| "Start Pipeline must reference a Write MP4 node".to_string())?;
    if output["data"]["enabled"] == false { return Err("The selected output is disabled".into()); }
    let encoder = pipeline_source(document, node_id(output), "video", "encode_media_foundation", "video")?;
    if edges(document).iter().any(|edge| edge["target"] == node_id(encoder) && edge["targetHandle"] == "in:audio") {
        return Err("Audio recording is not implemented yet; disconnect the audio input".into());
    }
    let screen = pipeline_source(document, node_id(encoder), "frames", "screen", "frames")?;
    let e = resolved_node_config(document, encoder)?;
    let s = resolved_node_config(document, screen)?;
    let r = if edges(document).iter().any(|edge| edge["target"] == node_id(screen) && edge["targetHandle"] == "in:region") {
        let region = pipeline_source(document, node_id(screen), "region", "region", "region")?;
        if node_kind(region) == "region" { resolved_node_config(document, region)? } else { selected_region(document, region)? }
    } else { s["region"].clone() };
    let p = if edges(document).iter().any(|edge| edge["target"] == node_id(output) && edge["targetHandle"] == "in:path") {
        resolved_node_config(document, pipeline_source(document, node_id(output), "path", "path", "path")?)?
    } else { resolved_node_config(document, output)?["path"].clone() };
    let string = |value: &Value, key: &str| -> Result<String, String> { value.get(key).and_then(Value::as_str).map(str::to_string).ok_or_else(|| format!("{key} must be a string")) };
    let number = |value: &Value, key: &str| -> Result<u32, String> {
        let number = value.get(key).and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
        number.and_then(|n| u32::try_from(n).ok()).ok_or_else(|| format!("{key} must be a nonnegative integer"))
    };
    let encoder_type = node_catalog().into_iter().find(|node| node.kind == node_kind(encoder)).ok_or("Encoder Provider was not found")?;
    for (field, options) in encoder_type.choices.as_object().unwrap() {
        let value = string(&e, field)?;
        if !options.as_array().unwrap().iter().any(|option| option == &value) {
            return Err(format!("{} does not support {field}: {value}", encoder_type.label));
        }
    }
    let mode = string(&r, "mode")?;
    if !["Full Display", "Rectangle"].contains(&mode.as_str()) { return Err("Region mode must be Full Display or Rectangle".into()); }
    let encoding = string(&e, "encodingMode")?;
    let (ow, oh) = match string(&e, "resolution")?.as_str() {
        "Source Size" => (0,0),
        "1920 × 1080" => (1920,1080), "2560 × 1440" => (2560,1440),
        _ => return Err("Resolution must be Source Size, 1920 × 1080, or 2560 × 1440".into()),
    };
    let bitrate = e.get("bitrate").and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
        .filter(|n| n.is_finite() && (0.1..=200.).contains(n)).ok_or_else(|| "Bitrate must be between 0.1 and 200 Mbps".to_string())?;
    let fps = number(&s,"fps")?;
    if ![24,30,60,120].contains(&fps) { return Err("Frame rate must be 24, 30, 60, or 120".into()); }
    let timestamp = document["_runTimestamp"].as_str().map(str::to_string).unwrap_or_else(|| now_nanos().to_string());
    let mut filename = string(&p, "filename")?.replace("{blueprint}", document["id"].as_str().unwrap_or("recording")).replace("{timestamp}", &timestamp);
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

struct CompiledRecordingOutput {
    node_id: String,
    encoder_id: String,
    plan: RecordingPlan,
}

fn recording_delay(document: &Value, source_id: &str) -> Result<Duration, String> {
    let source = nodes(document).iter().find(|node| node_id(node) == source_id).ok_or("Recording source was not found")?;
    let config = resolved_node_config(document, source)?;
    let seconds = config["startDelaySeconds"].as_f64().filter(|value| value.is_finite() && (0.0..=60.0).contains(value))
        .ok_or("Start delay must be between 0 and 60 seconds")?;
    Ok(Duration::from_secs_f64(seconds))
}

fn execution_document(document: &Value, outputs: &[String]) -> Result<Value, String> {
    let mut required = HashSet::new();
    let mut queue: VecDeque<_> = outputs.iter().cloned().collect();
    let mut connections = Vec::new();
    while let Some(id) = queue.pop_front() {
        if !required.insert(id.clone()) { continue; }
        let node = nodes(document).iter().find(|node| node_id(node) == id).ok_or_else(|| format!("Missing dependency '{id}'"))?;
        if node_kind(node) == "read_value" {
            queue.push_back(node_config(node)["definitionId"].as_str().unwrap_or_default().to_string());
        }
        for edge in edges(document).iter().filter(|edge| edge["target"] == id) {
            let (source, handle) = enabled_source(document,edge["source"].as_str().unwrap_or_default(),edge["sourceHandle"].as_str().unwrap_or_default(),&mut HashSet::new())?;
            let mut connection = edge.clone();
            connection["source"] = json!(node_id(source)); connection["sourceHandle"] = json!(handle);
            queue.push_back(node_id(source).to_string());
            connections.push(connection);
        }
    }
    let mut execution = document.clone();
    let mut graph = document["graphs"][0].clone();
    graph["nodes"] = json!(nodes(document).iter().filter(|node| required.contains(node_id(node))).cloned().collect::<Vec<_>>());
    graph["edges"] = json!(connections);
    execution["graphs"] = json!([graph]);
    execution["controls"] = json!([]); execution["displays"] = json!([]); execution["controlOrder"] = json!({});
    let errors = validate_graph_document(&execution,false,false);
    if !errors.is_empty() { return Err(errors.join("; ")); }
    Ok(execution)
}

fn compile_recording_outputs(document: &Value, source_id: &str) -> Result<Vec<CompiledRecordingOutput>, String> {
    let mut frozen = document.clone();
    if frozen.get("_runTimestamp").is_none() { frozen["_runTimestamp"] = json!(now_nanos().to_string()); }
    let document = &frozen;
    let source = nodes(document).iter().find(|node| node_id(node) == source_id && node_kind(node) == "screen")
        .ok_or("Recording source was not found")?;
    if source["data"]["enabled"] == false { return Err("Recording source is disabled".into()); }
    let mut output_ids = Vec::new();
    for encoder in nodes(document).iter().filter(|node| node_kind(node) == "encode_media_foundation" && node["data"]["enabled"] != false) {
        if !edges(document).iter().any(|edge| edge["source"] == source_id && edge["sourceHandle"] == "out:frames" && edge["target"] == node_id(encoder) && edge["targetHandle"] == "in:frames") { continue; }
        for output in nodes(document).iter().filter(|node| node_kind(node) == "write" && node["data"]["enabled"] != false) {
            if edges(document).iter().any(|edge| edge["source"] == node_id(encoder) && edge["sourceHandle"] == "out:video" && edge["target"] == node_id(output) && edge["targetHandle"] == "in:video") { output_ids.push(node_id(output).to_string()); }
        }
    }
    if output_ids.is_empty() { return Err("Recording source has no enabled output".into()); }
    let execution = execution_document(document, &output_ids)?;
    let document = &execution;
    recording_delay(document, source_id)?;
    let mut compiled = Vec::new();
    for output_id in output_ids {
        let encoder = pipeline_source(document, &output_id, "video", "encode_media_foundation", "video")?;
        let plan = recording_plan(document, Some(&output_id))?;
        compiled.push(CompiledRecordingOutput {node_id:output_id,encoder_id:node_id(encoder).into(),plan});
    }
    if compiled.is_empty() { return Err("Recording source has no enabled output".into()); }
    crate::recording::validate_output_paths(compiled.iter().map(|output| &output.plan.path))?;
    Ok(compiled)
}
fn now_nanos() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn target_orders_are_complete_unique_and_reference_only_visible_controls() {
        let original = document();
        assert!(validate_document(&original,false).is_empty());
        for order in [json!(null),json!([]),json!({}),json!({"main":[]}),json!({"main":["start","start"]}),json!({"main":["missing"]}),json!({"main":["start"],"region:missing":[]})] {
            let mut doc = original.clone();
            doc["controlOrder"] = order;
            assert!(validate_document(&doc,false).iter().any(|error| error.to_lowercase().contains("control order") || error.contains("controlOrder")));
        }
        let mut hidden = original.clone();
        hidden["controls"][0]["targets"] = json!([]);
        assert!(!validate_document(&hidden,false).is_empty());
        hidden["controlOrder"]["main"] = json!([]);
        assert!(validate_document(&hidden,false).is_empty());
    }
    #[test]
    fn disabled_values_bypass_only_a_unique_same_type_input() {
        let mut doc = json!({"graphs":[{"nodes":[
            {"id":"source","type":"make_integer","data":{"kind":"make_integer","config":{"value":42}}},
            {"id":"pass","type":"make_integer","data":{"kind":"make_integer","enabled":false,"config":{"value":7}}},
            {"id":"named","type":"define_value","data":{"kind":"define_value","enabled":false,"config":{"name":"Example"}}}
        ],"edges":[
            {"source":"source","sourceHandle":"out:value","target":"pass","targetHandle":"in:param:value"},
            {"source":"pass","sourceHandle":"out:value","target":"named","targetHandle":"in:value"}
        ]}]});
        assert_eq!(evaluate_value(&doc,"named",&mut HashSet::new(),0).unwrap(),json!(42));
        doc["graphs"][0]["nodes"][0]["data"]["enabled"] = json!(false);
        assert!(evaluate_value(&doc,"named",&mut HashSet::new(),0).unwrap_err().contains("needs one connection"));
        doc["graphs"][0]["edges"][0]["source"] = json!("pass");
        assert!(evaluate_value(&doc,"named",&mut HashSet::new(),0).unwrap_err().contains("cycle"));
    }

    #[test]
    fn disabled_region_selector_uses_its_connected_region_without_running_selection() {
        let mut doc = document();
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":"selector","type":"select_region","data":{"kind":"select_region","enabled":false,"config":{}}}));
        let links = doc["graphs"][0]["edges"].as_array_mut().unwrap();
        links.iter_mut().find(|edge| edge["target"] == "screen").unwrap()["source"] = json!("selector");
        links.push(json!({"source":"region","sourceHandle":"out:region","target":"selector","targetHandle":"in:initialRegion"}));
        assert!(recording_plan(&doc,Some("write")).is_ok());
        doc["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| edge["target"] != "selector");
        assert!(recording_plan(&doc,Some("write")).unwrap_err().contains("bypass input"));
    }

    #[test]
    fn recording_delay_belongs_to_capture_and_is_bounded() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        assert_eq!(recording_delay(&doc,"screen").unwrap(),Duration::ZERO);
        let source = doc["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node|node_kind(node)=="screen").unwrap();
        source["data"]["config"]["startDelaySeconds"] = json!(0.25);
        assert_eq!(recording_delay(&doc,"screen").unwrap(),Duration::from_millis(250));
        let source = doc["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node|node_kind(node)=="screen").unwrap();
        source["data"]["config"]["startDelaySeconds"] = json!(-1);
        assert!(recording_delay(&doc,"screen").is_err());
    }
    #[test]
    fn compiler_collects_shared_encoder_outputs_and_rejects_collisions() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        doc["_validateRegionStructure"] = json!(true);
        let encoder = nodes(&doc).iter().find(|node| node_kind(node) == "encode_media_foundation").unwrap()["id"].clone();
        let mut output = nodes(&doc).iter().find(|node| node_kind(node) == "write").unwrap().clone();
        output["id"] = json!("second-output");
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(output);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"second-stream","source":encoder,"sourceHandle":"out:video","target":"second-output","targetHandle":"in:video"}));
        let mut path = nodes(&doc).iter().find(|node| node_kind(node) == "path").unwrap().clone();
        path["id"] = json!("second-path");
        path["data"]["config"]["filename"] = json!("copy_{timestamp}.mp4");
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(path);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"second-path-link","source":"second-path","sourceHandle":"out:path","target":"second-output","targetHandle":"in:path"}));
        let outputs = compile_recording_outputs(&doc,"screen").unwrap();
        assert_eq!(outputs.len(), 2);
        assert_eq!(outputs[0].encoder_id, outputs[1].encoder_id);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().last_mut().unwrap()["source"] = json!("path");
        assert!(compile_recording_outputs(&doc,"screen").err().unwrap().contains("paths conflict"));
    }
    #[test]
    fn editor_catalog_contains_only_data_nodes_and_declares_actions() {
        let catalog = node_catalog();
        assert!(catalog.iter().all(|node| node.inputs.iter().chain(&node.outputs).all(|port| port.value_type != "flow")));
        let encode = catalog.iter().find(|node| node.kind == "encode_media_foundation").unwrap();
        assert_eq!(encode.provider, Some("media_foundation"));
        assert_eq!(catalog.iter().find(|node| node.kind == "screen").unwrap().actions, vec!["record"]);
    }
    #[test]
    fn controls_validate_stable_node_action_bindings() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        assert!(validate_document(&doc, false).is_empty());
        for control in doc["controls"].as_array_mut().unwrap() { control.as_object_mut().unwrap().remove("eventId"); }
        assert!(validate_document(&doc, false).is_empty());
        doc["controls"][0]["binding"]["nodeId"] = json!("missing-node");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("invalid node action binding")));
    }
    #[test]
    fn node_actions_enforce_capture_lifecycle() {
        assert!(node_action_allowed("screen", "start", "ready"));
        assert!(node_action_allowed("screen", "pause", "recording"));
        assert!(node_action_allowed("screen", "resume", "paused"));
        assert!(node_action_allowed("screen", "stop", "starting"));
        assert!(!node_action_allowed("screen", "start", "recording"));
        assert!(!node_action_allowed("write", "start", "ready"));
        assert!(!node_action_allowed("screen", "pause", "paused"));
    }

    #[test]
    fn document_control_definitions_override_registration_labels() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        doc["controls"][0]["label"] = json!("Direct document control");
        assert_eq!(execute_initialization(&doc).unwrap()[0]["label"], "Direct document control");
        assert!(validate_document(&doc, false).is_empty());
        doc["controls"][0]["binding"]["nodeId"] = json!("missing");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("invalid node action binding")));
    }
    #[test]
    fn named_values_resolve_and_validate_implicit_dependencies() {
        let mut doc = document();
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().extend([
            json!({"id":"named-source","type":"constant","data":{"kind":"constant","config":{"value":42}}}),
            json!({"id":"named-definition","type":"define_value","data":{"kind":"define_value","config":{"name":"Answer"}}}),
            json!({"id":"named-reader","type":"read_value","data":{"kind":"read_value","config":{"definitionId":"named-definition"}}}),
        ]);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"named-input","source":"named-source","sourceHandle":"out:value","target":"named-definition","targetHandle":"in:value"}));
        assert_eq!(evaluate_value(&doc, "named-reader", &mut HashSet::new(), 0).unwrap(), json!(42));
        assert!(validate_document(&doc, false).is_empty());
        doc["graphs"][0]["edges"].as_array_mut().unwrap().last_mut().unwrap()["source"] = json!("named-reader");
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("cycle")));
        assert!(evaluate_value(&doc, "named-reader", &mut HashSet::new(), 0).unwrap_err().contains("cycle"));
        doc["graphs"][0]["edges"].as_array_mut().unwrap().pop();
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":"duplicate-definition","type":"define_value","data":{"kind":"define_value","config":{"name":"Answer"}}}));
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("defined more than once")));
    }

    #[test]
    fn provider_node_owns_codec_parameter() {
        let catalog = node_catalog();
        assert!(catalog.iter().all(|node| node.kind != "encode"));
        let provider = catalog.iter().find(|node| node.kind == "encode_media_foundation").unwrap();
        assert_eq!(provider.default_config["codec"], "H.264");
        assert!(provider.default_config.get("encoder").is_none());
        assert!(provider.input_parameters.contains(&"codec"));
        assert_eq!(provider.choices["codec"], json!(["H.264"]));
        for (field, options) in provider.choices.as_object().unwrap() {
            assert!(options.as_array().unwrap().contains(&provider.default_config[field]));
        }
    }

    #[test]
    fn action_graph_is_selected_by_id_without_mutating_the_saved_document() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        let mut other = document["graphs"][0].clone();
        other["id"] = json!("second-graph");
        other["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node_kind(node) == "screen").unwrap()["data"]["enabled"] = json!(false);
        document["graphs"].as_array_mut().unwrap().push(other);
        let before = document.clone();
        let scoped = action_document(&document, "second-graph").unwrap();
        assert_eq!(scoped["graphs"][0]["id"], "second-graph");
        assert!(compile_recording_outputs(&scoped, "screen").is_err());
        assert!(compile_recording_outputs(&action_document(&document, "recording").unwrap(), "screen").is_ok());
        assert!(action_document(&document, "missing").is_err());
        assert_eq!(document, before);
        document["graphs"][1]["nodes"][0]["type"] = json!("invalid-visual-type");
        assert!(validate_document(&document, false).iter().any(|error| error.contains("visual type")));
        document["graphs"][1]["id"] = json!("recording");
        assert!(validate_document(&document, false).iter().any(|error| error.contains("Graph ID") && error.contains("duplicated")));
    }

    #[test]
    fn region_tool_registry_includes_every_graph() {
        let runtime = WorkflowRuntime::default();
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        let mut graph = document["graphs"][0].clone();
        graph["id"] = json!("other");
        for node in graph["nodes"].as_array_mut().unwrap() {
            if node_config(node).get("toolId").is_some() { node["data"]["config"]["toolId"] = json!("other-region"); }
        }
        document["graphs"].as_array_mut().unwrap().push(graph);
        assert!(runtime.activate(document).unwrap().diagnostics.is_empty());
        let definitions = runtime.tool_definitions();
        assert_eq!(definitions.len(), 2);
        assert!(definitions.contains_key("capture-region"));
        assert!(definitions.contains_key("other-region"));
    }

    #[test]
    fn frozen_run_reuses_the_preflight_filename_for_resource_creation() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        document["_runTimestamp"] = json!("frozen-run");
        let preflight = compile_recording_outputs(&document, "screen").unwrap();
        let creation = compile_recording_outputs(&document, "screen").unwrap();
        assert_eq!(preflight[0].plan.path, creation[0].plan.path);
        assert!(preflight[0].plan.path.to_string_lossy().contains("frozen-run"));
    }

    #[test]
    fn runtime_errors_map_only_failed_nodes_and_the_bound_capture_control() {
        let runtime = WorkflowRuntime::default();
        {
            let mut state = runtime.state.lock().unwrap();
            state.run_graph = "second".into(); state.run_source = "screen".into();
            state.output_nodes.insert("failed.mp4".into(), ("writer".into(),"encoder".into()));
            state.recording = Some(RecordingStats{outputs:vec![crate::recording::OutputStats{path:"failed.mp4".into(),partial_path:"failed.partial.mp4".into(),finished:true,error:Some("Disk failed".into()),encoder_error:None}],..Default::default()});
            state.controls = vec![json!({"id":"active","binding":{"graphId":"second","nodeId":"screen","action":"record"}}),json!({"id":"other","binding":{"graphId":"first","nodeId":"screen","action":"record"}})];
        }
        let snapshot = runtime.snapshot();
        assert_eq!(snapshot.node_errors.len(), 2);
        assert!(snapshot.node_errors.iter().any(|error| error.node_id == "writer"));
        assert!(!snapshot.node_errors.iter().any(|error| error.node_id == "encoder"));
        assert!(snapshot.controls[0]["error"].as_str().unwrap().contains("Disk failed"));
        assert!(snapshot.controls[1].get("error").is_none());
        runtime.state.lock().unwrap().recording.as_mut().unwrap().outputs[0].encoder_error = Some("Encoder failed".into());
        assert!(runtime.snapshot().node_errors.iter().any(|error| error.node_id == "encoder" && error.message == "Encoder failed"));
    }

    #[test]
    fn execution_preflight_ignores_unused_cycles_but_rejects_participating_cycles() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        for id in ["unused-a","unused-b"] {
            document["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":id,"type":"make_integer","data":{"kind":"make_integer","config":{"value":30}}}));
        }
        for (source,target) in [("unused-a","unused-b"),("unused-b","unused-a")] {
            document["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":format!("{source}-{target}"),"source":source,"sourceHandle":"out:value","target":target,"targetHandle":"in:param:value"}));
        }
        let runtime = WorkflowRuntime::default();
        let activation = runtime.activate(document.clone()).unwrap();
        assert!(activation.diagnostics.iter().any(|error| error.contains("cycle")));
        assert!(!activation.controls.is_empty());
        assert_eq!(compile_recording_outputs(&document,"screen").unwrap().len(), 1);
        document["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| !(edge["target"] == "screen" && edge["targetHandle"] == "in:param:fps"));
        document["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"cycle-fps","source":"unused-a","sourceHandle":"out:value","target":"screen","targetHandle":"in:param:fps"}));
        assert!(compile_recording_outputs(&document,"screen").err().unwrap().contains("cycle"));
    }

    #[test]
    fn unused_or_disabled_encoder_branches_do_not_validate_or_create_outputs() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        let mut encoder = nodes(&document).iter().find(|node| node_kind(node) == "encode_media_foundation").unwrap().clone();
        encoder["id"] = json!("unused-encoder"); encoder["data"]["config"]["codec"] = json!("H.265");
        document["graphs"][0]["nodes"].as_array_mut().unwrap().push(encoder);
        document["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"unused-frames","source":"screen","sourceHandle":"out:frames","target":"unused-encoder","targetHandle":"in:frames"}));
        assert_eq!(compile_recording_outputs(&document,"screen").unwrap().len(), 1);
        let mut output = nodes(&document).iter().find(|node| node_kind(node) == "write").unwrap().clone();
        output["id"] = json!("unused-output");
        document["graphs"][0]["nodes"].as_array_mut().unwrap().push(output);
        document["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"unused-video","source":"unused-encoder","sourceHandle":"out:video","target":"unused-output","targetHandle":"in:video"}));
        assert!(compile_recording_outputs(&document,"screen").err().unwrap().contains("codec"));
        document["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node_id(node)=="unused-encoder").unwrap()["data"]["enabled"] = json!(false);
        assert_eq!(compile_recording_outputs(&document,"screen").unwrap().len(), 1);
    }

    #[test]
    fn execution_preflight_bypasses_disabled_value_and_ignores_its_local_config() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        document["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| !(edge["target"]=="screen" && edge["targetHandle"]=="in:param:fps"));
        document["graphs"][0]["nodes"].as_array_mut().unwrap().extend([
            json!({"id":"active-fps","type":"make_integer","data":{"kind":"make_integer","config":{"value":30}}}),
            json!({"id":"disabled-fps","type":"make_integer","data":{"kind":"make_integer","enabled":false,"config":{"value":"ignored invalid local value"}}})
        ]);
        document["graphs"][0]["edges"].as_array_mut().unwrap().extend([
            json!({"id":"fps-pass","source":"active-fps","sourceHandle":"out:value","target":"disabled-fps","targetHandle":"in:param:value"}),
            json!({"id":"fps-capture","source":"disabled-fps","sourceHandle":"out:value","target":"screen","targetHandle":"in:param:fps"})
        ]);
        assert_eq!(compile_recording_outputs(&document,"screen").unwrap()[0].plan.fps,30);
    }

    #[test]
    fn three_media_nodes_run_with_local_region_and_path_and_restore_after_disconnect() {
        let mut document: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        document["values"]["regionMode"] = json!("Rectangle");
        for node in document["graphs"][0]["nodes"].as_array_mut().unwrap() {
            if node_kind(node) == "screen" { node["data"]["config"]["region"] = json!({"display":"Display 1","mode":"Rectangle","x":10,"y":20,"width":640,"height":480}); }
            if node_kind(node) == "write" { node["data"]["config"]["path"] = json!({"directory":"C:/LocalOutput","filename":"local.mp4"}); }
        }
        let output = nodes(&document).iter().find(|node| node_kind(node) == "write").unwrap()["id"].as_str().unwrap().to_string();
        let connected = recording_plan(&document, Some(&output)).unwrap();
        assert_eq!(connected.width, 897);
        assert!(!connected.path.to_string_lossy().contains("local.mp4"));
        document["graphs"][0]["nodes"].as_array_mut().unwrap().retain(|node| matches!(node_kind(node), "screen" | "encode_media_foundation" | "write"));
        document["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| matches!(edge["targetHandle"].as_str(), Some("in:frames" | "in:video")));
        let plan = recording_plan(&document, Some(&output)).unwrap();
        assert_eq!((plan.x,plan.y,plan.width,plan.height), (10,20,640,480));
        assert_eq!(plan.path, std::path::PathBuf::from("C:/LocalOutput").join("local.mp4"));
        assert_eq!(compile_recording_outputs(&document,"screen").unwrap().len(), 1);
        let screen = document["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node_kind(node) == "screen").unwrap();
        screen["data"]["config"]["region"] = json!({"width":642});
        let config = resolved_node_config(&document, nodes(&document).iter().find(|node| node_kind(node) == "screen").unwrap()).unwrap();
        assert_eq!(config["region"]["width"], 642);
        assert_eq!(config["region"]["display"], "Display 1");
        assert_eq!(config["region"]["mode"], "Full Display");
    }

    #[test]
    fn provider_choices_reject_unsupported_values_after_input_resolution() {
        let original: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        for (parameter, invalid) in [("codec", "H.265"), ("encodingMode", "FFmpeg"), ("resolution", "Unknown")] {
            let mut document = original.clone();
            document["values"]["regionMode"] = json!("Rectangle");
            document["values"][parameter] = json!(invalid);
            if parameter == "codec" {
                document["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut()
                    .find(|node| node_kind(node) == "encode_media_foundation").unwrap()["data"]["config"][parameter] = json!(invalid);
            }
            let output = nodes(&document).iter().find(|node| node_kind(node) == "write").unwrap();
            let error = recording_plan(&document, Some(node_id(output))).unwrap_err();
            assert!(error.contains(&format!("does not support {parameter}: {invalid}")), "{error}");
        }
    }

    #[test]
    fn parameter_inputs_work_without_exposure_configuration() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        for node in doc["graphs"][0]["nodes"].as_array_mut().unwrap() {
            if let Some(config) = node["data"]["config"].as_object_mut() { config.remove("exposedInputs"); }
        }
        assert!(validate_document(&doc, false).is_empty());
        let encoder = nodes(&doc).iter().find(|node| node_kind(node) == "screen").unwrap();
        assert_eq!(node_port_type(&doc, &node_catalog(), encoder, "in:param:fps", "in"), Some("integer"));
        assert_eq!(resolved_node_config(&doc, encoder).unwrap()["fps"], 60);
    }

    #[test]
    fn disabled_media_stages_never_start() {
        let original: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        let output = nodes(&original).iter().find(|node| node_kind(node) == "write").unwrap()["id"].as_str().unwrap().to_string();
        for kind in ["screen", "encode_media_foundation", "write"] {
            let mut doc = original.clone();
            let stage = doc["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node_kind(node) == kind).unwrap();
            stage["data"]["enabled"] = json!(false);
            assert!(recording_plan(&doc, Some(&output)).unwrap_err().contains("disabled"));
        }
    }

    #[test]
    fn controls_have_independent_target_orders() {
        let mut doc = document();
        let id = execute_initialization(&doc).unwrap()[0]["id"].clone();
        doc["controlOrder"] = json!({"main":["other",id.clone()],"region:test":[id]});
        let controls = execute_initialization(&doc).unwrap();
        assert_eq!(controls[0]["targetOrder"]["main"], 1);
        assert_eq!(controls[0]["targetOrder"]["region:test"], 0);
    }

    #[test]
    fn region_ui_registry_and_live_values() {
        let mut doc: Value = serde_json::from_str(include_str!("../../blueprints/builtin/screen-recording.nodrec.json")).unwrap();
        assert!(validate_document(&doc, true).is_empty(), "{:?}", validate_document(&doc, true));
        let ui = execute_initialization(&doc).unwrap();
        assert_eq!(ui.iter().filter(|c| c["kind"] == "display").count(), 2);
        assert_eq!(ui.iter().find(|c| c["id"] == "start-recording").unwrap()["targets"], json!(["main", "region:capture-region"]));
        assert!(recording_plan(&doc, Some("write")).unwrap_err().contains("Select a region"));
        doc["_selectedRegions"] = json!({"capture-region":{"display":"test-display","mode":"Rectangle","x":23,"y":41,"width":897,"height":360}});
        let mut legacy = doc.clone();
        legacy["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| edge["targetHandle"] != "in:selected");
        assert_eq!(recording_plan(&legacy, Some("write")).unwrap().x, 23);
        let mut linked = doc.clone();
        linked["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node_kind(node)=="get_selected_region").unwrap()["data"]["config"]["toolId"] = json!("different-tool");
        assert_eq!(recording_plan(&linked, Some("write")).unwrap().x, 23);
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
        for (id, field, bad) in [("register-start", "control", json!({"targets":["region:missing"]})), ("register-status", "display", json!({"source":"unsupported"})), ("register-time", "display", json!({"id":"start-recording"})), ("register-status", "display", json!({"binding":{"graphId":"recording","nodeId":"write","action":"record"}})), ("register-status", "display", json!({"binding":{"graphId":"missing","nodeId":"screen","action":"record"}}))] {
            let mut bad_doc = doc.clone();
            let items = if field == "control" { "controls" } else { "displays" };
            let item_id = match id { "register-start" => "start-recording", "register-status" => "recording-status", _ => "recording-time" };
            let item = bad_doc[items].as_array_mut().unwrap().iter_mut().find(|item| item["id"] == item_id).unwrap();
            item.as_object_mut().unwrap().extend(bad.as_object().unwrap().clone());
            assert!(!validate_document(&bad_doc, false).is_empty());
        }
    }

    fn document() -> Value {
        let nodes = [("screen","screen"),("region","region"),("encode_media_foundation","encode_media_foundation"),("path","path"),("write","write")]
            .into_iter().map(|(id,kind)| json!({"id":id,"type":kind,"data":{"kind":kind,"label":id,"config":{}},"position":{"x":0,"y":0}})).collect::<Vec<_>>();
        let edges = [("screen","encode_media_foundation","frames","frames"),("region","screen","region","region"),("encode_media_foundation","write","video","video"),("path","write","path","path")]
            .iter().enumerate().map(|(index,(source,target,from,to))|json!({"id":format!("e{}",index+2),"source":source,"sourceHandle":format!("out:{from}"),"target":target,"targetHandle":format!("in:{to}")})).collect::<Vec<_>>();
        json!({"schemaVersion":2,"id":"test","name":"Test","supported":true,"controls":[{"id":"start","label":"Record","icon":"play","enabled":true,"targets":["main"],"binding":{"graphId":"recording","nodeId":"screen","action":"record"}}],"displays":[],"controlOrder":{"main":["start"]},"graphs":[{"id":"recording","name":"Recording","nodes":nodes,"edges":edges}]})
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
            doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({
                "id":id,"type":kind,"position":{"x":0,"y":0},
                "data":{"kind":kind,"label":kind,"config":{"value":value}}
            }));
        }
        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        for (id, _, expected) in &cases {
            assert_eq!(evaluate_value(&doc, id, &mut HashSet::new(), 0).unwrap(), *expected);
        }
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node|node_id(node)=="byte").unwrap()["data"]["config"]["value"] = json!(256);
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("invalid typed value")));
    }

    #[test]
    fn exposed_make_value_inputs_keep_their_unreal_type() {
        let mut doc = document();
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().extend([
            json!({"id":"byte-target","type":"make_byte","position":{"x":0,"y":0},"data":{"kind":"make_byte","label":"Byte","config":{"value":0}}}),
            json!({"id":"integer-source","type":"make_integer","position":{"x":0,"y":0},"data":{"kind":"make_integer","label":"Integer","config":{"value":12}}}),
        ]);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"typed-input","source":"integer-source","sourceHandle":"out:value","target":"byte-target","targetHandle":"in:param:value"}));
        assert!(validate_document(&doc, false).iter().any(|error| error.contains("incompatible types")));

        let source = doc["graphs"][0]["nodes"].as_array_mut().unwrap().iter_mut().find(|node| node["id"] == "integer-source").unwrap();
        source["type"] = json!("make_byte");
        source["data"]["kind"] = json!("make_byte");
        assert!(validate_document(&doc, false).is_empty(), "{:?}", validate_document(&doc, false));
        assert_eq!(evaluate_value(&doc, "byte-target", &mut HashSet::new(), 0).unwrap(), json!(12));
    }

    #[test]
    fn node_parameters_are_overridden_by_typed_inputs_and_keep_local_values() {
        let mut doc = document();
        doc["graphs"][0]["nodes"][0]["data"]["config"]["fps"] = json!(60);
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":"make-fps","type":"make_integer","data":{"kind":"make_integer","config":{"value":30}}}));
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":"fps-input","source":"make-fps","sourceHandle":"out:value","target":"screen","targetHandle":"in:param:fps"}));
        assert!(validate_document(&doc,false).is_empty());
        assert_eq!(recording_plan(&doc,Some("write")).unwrap().fps,30);
        let source = doc["graphs"][0]["nodes"].as_array_mut().unwrap().last_mut().unwrap();
        source["type"] = json!("make_string"); source["data"]["kind"] = json!("make_string"); source["data"]["config"]["value"] = json!("wrong type");
        assert!(validate_document(&doc,false).iter().any(|error|error.contains("incompatible types")));
        doc["graphs"][0]["edges"].as_array_mut().unwrap().pop();
        assert_eq!(recording_plan(&doc,Some("write")).unwrap().fps,60);
    }

    #[test]
    fn data_graph_is_valid_and_disconnected_streams_fail_run_preflight() {
        let doc = document();
        assert!(validate_document(&doc, true).is_empty(), "{:?}", validate_document(&doc, true));
        let mut disconnected = doc.clone();
        disconnected["graphs"][0]["edges"].as_array_mut().unwrap().retain(|edge| edge["id"] != "e2");
        assert!(validate_document(&disconnected, true).iter().any(|error| error.contains("no enabled output")));
        assert!(validate_document(&disconnected, false).is_empty());
    }

    #[test]
    fn recording_plan_supports_fanout_and_rejects_audio_and_invalid_parameters() {
        let mut doc = document();
        let plan = recording_plan(&doc, Some("write")).unwrap();
        assert_eq!((plan.fps,plan.bitrate), (60,20_000_000));
        assert!(!plan.software);
        doc["graphs"][0]["nodes"][2]["data"]["config"] = json!({"encodingMode":"Software","fps":30,"resolution":"1920 × 1080","bitrate":"12.5"});
        doc["graphs"][0]["nodes"][0]["data"]["config"]["fps"] = json!(30);
        let plan = recording_plan(&doc, Some("write")).unwrap();
        assert!(plan.software); assert_eq!((plan.output_width,plan.fps,plan.bitrate), (1920,30,12_500_000));
        doc["graphs"][0]["nodes"][0]["data"]["config"]["fps"] = json!(0);
        assert!(recording_plan(&doc, Some("write")).is_err());
        doc["graphs"][0]["nodes"][0]["data"]["config"]["fps"] = json!(60);
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"source":"region","sourceHandle":"out:audio","target":"encode_media_foundation","targetHandle":"in:audio"}));
        assert!(recording_plan(&doc, Some("write")).unwrap_err().contains("Audio"));
        doc["graphs"][0]["edges"].as_array_mut().unwrap().pop();
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"source":"screen","sourceHandle":"out:frames","target":"another-encoder","targetHandle":"in:frames"}));
        assert!(recording_plan(&doc, Some("write")).is_ok());
    }

    #[test]
    fn recording_plan_resolves_parameter_inputs_and_rejects_unsafe_filenames() {
        let mut doc = document();
        doc["graphs"][0]["nodes"][1]["data"]["config"] = json!({"display":"Display 1","mode":"Rectangle","width":897,"height":360,"x":0,"y":0});
        assert!(!recording_plan(&doc, Some("write")).unwrap().full_display);
        doc["graphs"][0]["nodes"][2]["data"]["config"] = json!({"fps":60});
        doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":"custom-fps","type":"make_integer","data":{"kind":"make_integer","config":{"value":30}}}));
        doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"source":"custom-fps","sourceHandle":"out:value","target":"screen","targetHandle":"in:param:fps"}));
        assert_eq!(recording_plan(&doc,Some("write")).unwrap().fps,30);
        doc["graphs"][0]["nodes"][3]["data"]["config"] = json!({"filename":"../existing.mp4","directory":"C:/Recordings"});
        assert!(recording_plan(&doc,Some("write")).is_err());
    }

    #[test]
    fn invalid_cycles_are_rejected_before_resolving_media_parameters() {
        let mut doc = document();
        for id in ["a", "b"] {
            doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":id,"type":"make_integer","data":{"kind":"make_integer","config":{"value":60}}}));
        }
        doc["graphs"][0]["nodes"][2]["data"]["config"] = json!({"fps":60});
        for (source,target,input) in [("a","b","value"),("b","a","value"),("a","encode_media_foundation","fps")] {
            doc["graphs"][0]["edges"].as_array_mut().unwrap().push(json!({"id":format!("{source}-{target}"),"source":source,"sourceHandle":"out:value","target":target,"targetHandle":format!("in:param:{input}")}));
        }
        assert!(validate_document(&doc, true).iter().any(|error| error.contains("cycle")));
    }

    #[test]
    fn removed_execution_nodes_and_missing_action_bindings_are_rejected() {
        for kind in ["event","register_control","register_menu","register_display","update_control","start_pipeline","pause_pipeline","resume_pipeline","stop_pipeline","delay","log","branch"] {
            let mut doc = document();
            doc["graphs"][0]["nodes"].as_array_mut().unwrap().push(json!({"id":"obsolete","type":kind,"data":{"kind":kind,"config":{}}}));
            assert!(validate_document(&doc,false).iter().any(|error| error.contains("Unknown node type")),"{kind}");
        }
        let mut doc = document();
        doc["controls"][0].as_object_mut().unwrap().remove("binding");
        assert!(validate_document(&doc,false).iter().any(|error|error.contains("needs a node action binding")));
        doc["graphs"][0]["nodes"][0]["type"] = json!("path");
        assert!(validate_document(&doc,false).iter().any(|error|error.contains("visual type")));
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
                assert_eq!(execute_initialization(&document).unwrap().len(), 4);
            } else {
                assert!(validate_document(&document, true).iter().any(|error| error.contains("preview")));
                assert_eq!(execute_initialization(&document).unwrap().len(), 0);
            }
        }
    }
}
