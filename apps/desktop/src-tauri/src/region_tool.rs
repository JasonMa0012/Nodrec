use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, sync::{Arc, Mutex}};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use crate::recording::DisplayInfo;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Rect { pub x: i32, pub y: i32, pub width: u32, pub height: u32 }

impl Rect {
    pub fn validate(&self, display: &DisplayInfo) -> Result<(), String> {
        if self.x < 0 || self.y < 0 || self.width < 16 || self.height < 16
            || self.x as u64 + self.width as u64 > display.width as u64
            || self.y as u64 + self.height as u64 > display.height as u64 {
            return Err("Region must be at least 16 × 16 physical pixels and inside its display".into());
        }
        Ok(())
    }
}

fn restored_region(value: Option<&Value>, display: &DisplayInfo, single_display: bool) -> Option<Rect> {
    let value = value?;
    if let Some(id) = value.get("display").and_then(Value::as_str) {
        if id != display.id && !(id == "Display 1" && single_display) { return None; }
    }
    let rect: Rect = serde_json::from_value(value.clone()).ok()?;
    rect.validate(display).ok()?;
    Some(rect)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub token: String, pub blueprint_id: String, pub tool_id: String,
    pub display: DisplayInfo, pub scale: f64, pub work: Rect,
    pub rect: Option<Rect>, pub picking: bool, pub visible: bool,
    pub excluded: bool, pub capture_exclusion: bool, pub aspect_ratio: f64,
    #[serde(skip)] pub outcome: Option<bool>,
}

#[derive(Default)]
struct Tools { active: Option<Tool>, selected: HashMap<String, Value>, ready: HashSet<String> }

#[derive(Clone, Default)]
pub struct RegionTools(Arc<Mutex<Tools>>);

impl RegionTools {
    pub fn close(&self, app: &AppHandle) {
        for label in ["region-frame", "region-toolbar"] {
            if let Some(window) = app.get_webview_window(label) { let _ = window.destroy(); }
        }
        let mut tools = self.0.lock().unwrap_or_else(|e| e.into_inner());
        tools.active = None;
        tools.ready.clear();
    }
    pub fn reset(&self, app: &AppHandle) {
        self.close(app);
        self.0.lock().unwrap_or_else(|e| e.into_inner()).selected.clear();
    }
    pub fn selected(&self) -> HashMap<String, Value> { self.0.lock().unwrap_or_else(|e| e.into_inner()).selected.clone() }
    pub fn snapshot(&self) -> Option<Tool> { self.0.lock().unwrap_or_else(|e| e.into_inner()).active.clone() }
    pub fn ready(&self, label: &str) { self.0.lock().unwrap_or_else(|e| e.into_inner()).ready.insert(label.into()); }
    fn is_ready(&self, label: &str) -> bool { self.0.lock().unwrap_or_else(|e| e.into_inner()).ready.contains(label) }
    pub fn check(&self, token: &str, blueprint: &str) -> Result<Tool, String> {
        self.snapshot().filter(|t| t.token == token && t.blueprint_id == blueprint)
            .ok_or_else(|| "This region tool session has expired".into())
    }
    pub fn open(&self, app: &AppHandle, blueprint_id: &str, config: &Value) -> Result<(), String> {
        let tool_id = config["toolId"].as_str().ok_or("Select Region needs a toolId")?;
        let displays = crate::recording::displays()?;
        let name = config["display"].as_str().unwrap_or("Display 1");
        let display = displays.iter().find(|d| d.id == name).or_else(|| if name == "Display 1" && displays.len() == 1 { displays.first() } else { None }).cloned().ok_or("Select a valid display")?;
        let monitor = app.available_monitors().map_err(|e| e.to_string())?.into_iter()
            .find(|m| m.position().x == display.x && m.position().y == display.y).ok_or("Display is no longer available")?;
        let scale = monitor.scale_factor();
        let work_area = monitor.work_area();
        if work_area.size.width == 0 || work_area.size.height == 0 { return Err("Display work area is unavailable".into()); }
        let work = Rect { x: work_area.position.x - display.x, y: work_area.position.y - display.y, width: work_area.size.width, height: work_area.size.height };
        let token = format!("{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        let remembered = self.selected().get(tool_id).cloned();
        let initial = restored_region(remembered.as_ref().or_else(|| config.get("initialRegion")), &display, displays.len() == 1);
        {
            let mut tools = self.0.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(rect) = &initial {
                tools.selected.insert(tool_id.into(), json!({"display":display.id,"mode":"Rectangle","x":rect.x,"y":rect.y,"width":rect.width,"height":rect.height}));
            } else {
                tools.selected.remove(tool_id);
            }
        }
        if let Some(mut tool) = self.snapshot().filter(|t| t.tool_id == tool_id && t.blueprint_id == blueprint_id && t.display.id == display.id && t.display.x == display.x && t.display.y == display.y && t.display.width == display.width && t.display.height == display.height && t.scale == scale) {
            tool.visible = true;
            tool.work = work;
            tool.picking = initial.is_none();
            tool.outcome = initial.as_ref().map(|_| true);
            tool.rect = initial;
            self.0.lock().unwrap_or_else(|e| e.into_inner()).active = Some(tool);
            return self.refresh(app);
        }
        self.close(app);
        // Tauri removes destroyed windows asynchronously; wait before reusing their labels.
        for _ in 0..100 {
            if app.get_webview_window("region-frame").is_none() && app.get_webview_window("region-toolbar").is_none() { break; }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let picking = initial.is_none();
        let tool = Tool { token: token.clone(), blueprint_id: blueprint_id.into(), tool_id: tool_id.into(), display: display.clone(), scale, work, rect: initial, picking, visible: true, excluded: false, capture_exclusion: true, aspect_ratio: 0., outcome: if picking { None } else { Some(true) } };
        self.0.lock().unwrap_or_else(|e| e.into_inner()).active = Some(tool);
        let result = (|| -> Result<bool, String> {
            let mut excluded = true;
            for (label, role) in [("region-frame", "frame"), ("region-toolbar", "toolbar")] {
                let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(format!("index.html?regionRole={role}&token={token}").into()))
                    .title(format!("Nodrec Region {role}")).decorations(false).transparent(true).shadow(false).always_on_top(true)
                    .skip_taskbar(true).focused(false).resizable(false).visible(false).build().map_err(|e| e.to_string())?;
                window.set_position(PhysicalPosition::new(display.x, display.y)).map_err(|e| e.to_string())?;
                if role == "frame" { window.set_size(PhysicalSize::new(display.width, display.height)).map_err(|e| e.to_string())?; }
                excluded &= set_capture_affinity(&window, true).is_ok();
            }
            Ok(excluded)
        })();
        match result {
            Ok(excluded) => { if let Some(t) = self.0.lock().unwrap_or_else(|e| e.into_inner()).active.as_mut() { t.excluded = excluded; } Ok(()) }
            Err(e) => { self.close(app); Err(e) }
        }
    }
    pub fn update(&self, app: &AppHandle, token: &str, blueprint: &str, action: &str, rect: Option<Rect>, locked: bool) -> Result<(), String> {
        let mut tool = self.check(token, blueprint)?;
        if locked && matches!(action, "change" | "select" | "reselect") { return Err("Stop recording before changing its region".into()); }
        if action == "close" { self.close(app); return Ok(()); }
        match action {
            "change" | "select" => {
                let rect = rect.ok_or("A region is required")?;
                rect.validate(&tool.display)?;
                tool.rect = Some(rect.clone());
                if action == "select" { tool.picking = false; tool.outcome = Some(true); }
                if !tool.picking {
                    self.0.lock().unwrap_or_else(|e| e.into_inner()).selected.insert(tool.tool_id.clone(), json!({"display":tool.display.id,"mode":"Rectangle","x":rect.x,"y":rect.y,"width":rect.width,"height":rect.height}));
                }
            }
            "reselect" => { tool.picking = true; tool.outcome = None; }
            "cancel" => { tool.picking = false; tool.outcome = Some(false); if tool.rect.is_none() { tool.visible = false; } }
            "hide" => { tool.visible = false; if tool.picking { tool.picking = false; tool.outcome = Some(false); } }
            "show" => tool.visible = true,
            "exclude-capture" | "allow-capture" => {
                let enabled = action == "exclude-capture";
                for label in ["region-frame", "region-toolbar"] {
                    if let Some(window) = app.get_webview_window(label) {
                        apply_capture_affinity(&window, enabled)?;
                    }
                }
                tool.capture_exclusion = enabled;
                tool.excluded = enabled;
            }
            "ready" => {},
            _ => return Err("Unknown region tool action".into()),
        }
        self.0.lock().unwrap_or_else(|e| e.into_inner()).active = Some(tool);
        self.refresh(app)
    }
    pub fn refresh(&self, app: &AppHandle) -> Result<(), String> {
        let Some(tool) = self.snapshot() else { return Ok(()); };
        if let Some(window) = app.get_webview_window("region-frame") {
            set_frame_region(&window, &tool)?;
            set_visible(&window, tool.visible && self.is_ready("region-frame"), tool.capture_exclusion)?;
        }
        if let Some(window) = app.get_webview_window("region-toolbar") {
            set_visible(&window, tool.visible && !tool.picking && self.is_ready("region-toolbar"), tool.capture_exclusion)?;
        }
        let _ = app.emit("region-tool", &tool);
        Ok(())
    }
    pub fn set_ratio(&self, app: &AppHandle, token: &str, blueprint: &str, ratio: f64, locked: bool) -> Result<(), String> {
        self.check(token, blueprint)?;
        if locked || !ratio.is_finite() || ratio < 0. || ratio > 32768. { return Err("Invalid aspect ratio or recording is active".into()); }
        if let Some(tool) = self.0.lock().unwrap_or_else(|e| e.into_inner()).active.as_mut() { tool.aspect_ratio = ratio; }
        self.refresh(app)
    }
    pub fn validate_display(&self, app: &AppHandle) -> Result<(), String> {
        let Some(tool) = self.snapshot() else { return Ok(()); };
        if !crate::recording::displays()?.iter().any(|d| d.id == tool.display.id && d.x == tool.display.x && d.y == tool.display.y && d.width == tool.display.width && d.height == tool.display.height) {
            self.reset(app); return Err("Display changed; select the region again".into());
        }
        if let Some(monitor) = app.available_monitors().map_err(|e| e.to_string())?.iter().find(|m| m.position().x == tool.display.x && m.position().y == tool.display.y) {
            if monitor.scale_factor() != tool.scale { self.reset(app); return Err("Display DPI changed; select the region again".into()); }
        }
        Ok(())
    }
    pub fn enforce_capture_exclusion(&self, app: &AppHandle, locked: bool) {
        if let Some(tool) = self.snapshot() {
            if let Some(frame) = app.get_webview_window("region-frame") {
                let _ = set_visible(&frame, tool.visible && self.is_ready("region-frame"), tool.capture_exclusion);
            }
            if locked && tool.capture_exclusion && !tool.excluded {
                if let Some(toolbar) = app.get_webview_window("region-toolbar") { let _ = set_visible(&toolbar, false, tool.capture_exclusion); }
            }
        }
    }
}

fn set_visible(window: &tauri::WebviewWindow, visible: bool, excluded: bool) -> Result<(), String> {
    if window.is_visible().map_err(|e| e.to_string())? == visible { return Ok(()); }
    if !visible { return window.hide().map_err(|e| e.to_string()); }
    window.show().map_err(|e| e.to_string())?;
    apply_capture_affinity(window, excluded)
}

fn apply_capture_affinity(window: &tauri::WebviewWindow, excluded: bool) -> Result<(), String> {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let shown = window.clone();
    window.run_on_main_thread(move || {
        let result = set_capture_affinity(&shown, excluded);
        if result.is_err() { let _ = shown.hide(); }
        let _ = send.send(result);
    }).map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn set_capture_affinity(window: &tauri::WebviewWindow, excluded: bool) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, GetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
    unsafe {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        SetWindowDisplayAffinity(hwnd, WDA_NONE).map_err(|e| e.to_string())?;
        let desired = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        SetWindowDisplayAffinity(hwnd, desired).map_err(|e| e.to_string())?;
        let mut affinity = 0;
        GetWindowDisplayAffinity(hwnd, &mut affinity).map_err(|e| e.to_string())?;
        if affinity != desired.0 { return Err("Capture visibility setting was not applied".into()); }
    }
    Ok(())
}
#[cfg(not(windows))]
fn set_capture_affinity(_: &tauri::WebviewWindow, _: bool) -> Result<(), String> { Err("Windows required".into()) }

#[cfg(windows)]
fn set_frame_region(window: &tauri::WebviewWindow, tool: &Tool) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, CombineRgn, DeleteObject, SetWindowRgn, RGN_DIFF, RGN_OR};
    unsafe {
        let hwnd = window.hwnd().map_err(|e| e.to_string())?;
        let region = if tool.picking { CreateRectRgn(0, 0, tool.display.width as i32, tool.display.height as i32) }
        else if let Some(r) = &tool.rect {
            let margin = (4. * tool.scale).ceil() as i32;
            let outer = CreateRectRgn(r.x-margin, r.y-margin, r.x+r.width as i32+margin, r.y+r.height as i32+margin);
            let inner = CreateRectRgn(r.x+margin, r.y+margin, r.x+r.width as i32-margin, r.y+r.height as i32-margin);
            if outer.is_invalid() || inner.is_invalid() || CombineRgn(Some(outer), Some(outer), Some(inner), RGN_DIFF).0 == 0 {
                let _ = DeleteObject(inner.into()); let _ = DeleteObject(outer.into()); return Err("Cannot allocate native border region".into());
            }
            let _ = DeleteObject(inner.into());
            let half = (6. * tool.scale).ceil() as i32;
            for (x, y) in [(r.x,r.y),(r.x+r.width as i32/2,r.y),(r.x+r.width as i32,r.y),(r.x+r.width as i32,r.y+r.height as i32/2),(r.x+r.width as i32,r.y+r.height as i32),(r.x+r.width as i32/2,r.y+r.height as i32),(r.x,r.y+r.height as i32),(r.x,r.y+r.height as i32/2)] {
                let handle = CreateRectRgn(x-half,y-half,x+half,y+half);
                if handle.is_invalid() || CombineRgn(Some(outer),Some(outer),Some(handle),RGN_OR).0 == 0 {
                    let _ = DeleteObject(handle.into()); let _ = DeleteObject(outer.into()); return Err("Cannot allocate native resize handles".into());
                }
                let _ = DeleteObject(handle.into());
            }
            outer
        } else { CreateRectRgn(0, 0, 0, 0) };
        if region.is_invalid() || SetWindowRgn(hwnd, Some(region), true) == 0 { let _ = DeleteObject(region.into()); return Err("Cannot set native region window shape".into()); }
    }
    Ok(())
}
#[cfg(not(windows))]
fn set_frame_region(_: &tauri::WebviewWindow, _: &Tool) -> Result<(), String> { Err("Region tools currently require Windows".into()) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn restore_only_valid_regions() {
        let display = DisplayInfo { id:"d".into(), name:"d".into(), width:1920,height:1080,x:-1920,y:0,hdr:false };
        let valid = json!({"display":"d","x":100,"y":200,"width":640,"height":480});
        assert_eq!(restored_region(Some(&valid), &display, false), Some(Rect{x:100,y:200,width:640,height:480}));
        assert!(restored_region(None, &display, false).is_none());
        for patch in [json!({"display":"other"}), json!({"x":-1}), json!({"width":15}), json!({"height":0}), json!({"x":1800}), json!({"y":1000}), json!({"width":"invalid"})] {
            let mut invalid = valid.clone();
            for (key, value) in patch.as_object().unwrap() { invalid[key] = value.clone(); }
            assert!(restored_region(Some(&invalid), &display, false).is_none(), "{invalid}");
        }
        let mut alias = valid.clone(); alias["display"] = json!("Display 1");
        assert!(restored_region(Some(&alias), &display, true).is_some());
        assert!(restored_region(Some(&alias), &display, false).is_none());
    }
    #[test] fn physical_region_boundaries() {
        let display = DisplayInfo { id:"d".into(), name:"d".into(), width:1920,height:1080,x:-1920,y:0,hdr:false };
        assert!(Rect{x:0,y:0,width:1920,height:1080}.validate(&display).is_ok());
        for r in [Rect{x:-1,y:0,width:16,height:16}, Rect{x:0,y:0,width:15,height:16}, Rect{x:1905,y:0,width:16,height:16}, Rect{x:0,y:0,width:u32::MAX,height:16}] { assert!(r.validate(&display).is_err()); }
        assert!(RegionTools::default().check("expired", "other-blueprint").is_err());
    }
}

#[cfg(windows)]
pub fn set_toolbar_shape(window: &tauri::WebviewWindow, areas: Vec<Rect>) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, CombineRgn, DeleteObject, SetWindowRgn, RGN_OR};
    if areas.len() > 64 || areas.iter().any(|r| r.x < 0 || r.y < 0 || r.x > 32768 || r.y > 32768 || r.width > 32768 || r.height > 32768) { return Err("Invalid toolbar shape".into()); }
    let shown = window.clone();
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    window.run_on_main_thread(move || {
        let result = (|| unsafe {
            let hwnd = shown.hwnd().map_err(|e| e.to_string())?;
            let region = CreateRectRgn(0, 0, 0, 0);
            if region.is_invalid() { return Err("Cannot allocate toolbar shape".to_string()); }
            for r in areas {
                let part = CreateRectRgn(r.x, r.y, r.x + r.width as i32, r.y + r.height as i32);
                let valid = !part.is_invalid() && CombineRgn(Some(region), Some(region), Some(part), RGN_OR).0 != 0;
                let _ = DeleteObject(part.into());
                if !valid { let _ = DeleteObject(region.into()); return Err("Cannot combine toolbar shape".to_string()); }
            }
            if SetWindowRgn(hwnd, Some(region), true) == 0 { let _ = DeleteObject(region.into()); return Err("Cannot set toolbar shape".to_string()); }
            Ok(())
        })();
        let _ = send.send(result);
    }).map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}
#[cfg(not(windows))]
pub fn set_toolbar_shape(_: &tauri::WebviewWindow, _: Vec<Rect>) -> Result<(), String> { Err("Windows required".into()) }
