use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex, mpsc}, thread, time::{Duration, Instant}};

#[cfg(windows)]
mod windows;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    pub id: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub hdr: bool,
}

pub fn displays() -> Result<Vec<DisplayInfo>, String> {
    #[cfg(windows)] { windows::displays().map_err(|error| error.to_string()) }
    #[cfg(not(windows))] { Err("Screen recording currently requires Windows".into()) }
}

#[derive(Clone, Debug)]
pub struct RecordingPlan {
    pub display: String,
    pub full_display: bool,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub output_width: u32,
    pub output_height: u32,
    pub fps: u32,
    pub bitrate: u32,
    pub software: bool,
    pub cursor: bool,
    pub path: PathBuf,
}

impl RecordingPlan {
    pub fn validate(&mut self, display: &DisplayInfo) -> Result<(), String> {
        if display.hdr { return Err("HDR displays are not supported yet; switch the display to SDR".into()); }
        if self.full_display { self.x = 0; self.y = 0; self.width = display.width; self.height = display.height; }
        if self.width == 0 || self.height == 0 || self.x.checked_add(self.width).is_none_or(|right| right > display.width)
            || self.y.checked_add(self.height).is_none_or(|bottom| bottom > display.height) {
            return Err("Recording rectangle must be inside the selected display (physical pixels)".into());
        }
        if self.output_width == 0 && self.output_height == 0 {
            self.output_width = (self.width + 1) & !1;
            self.output_height = (self.height + 1) & !1;
        }
        if self.output_width == 0 || self.output_height == 0 || self.output_width % 2 != 0 || self.output_height % 2 != 0
            || self.output_width > 8192 || self.output_height > 8192 { return Err("H.264 output dimensions must be positive even numbers, at most 8192".into()); }
        if ![24, 30, 60, 120].contains(&self.fps) { return Err("Frame rate must be 24, 30, 60, or 120".into()); }
        if !(100_000..=200_000_000).contains(&self.bitrate) { return Err("Bitrate must be between 0.1 and 200 Mbps".into()); }
        if self.path.extension().is_none_or(|ext| !ext.eq_ignore_ascii_case("mp4")) { return Err("Output must be an .mp4 file".into()); }
        Ok(())
    }
}

#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStats {
    pub encoder: String,
    pub adapter: String,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub duration_ms: u64,
    pub encoded_frames: u64,
    pub dropped_frames: u64,
    pub repeated_frames: u64,
    pub output_path: String,
    pub partial_path: String,
    pub stop_ms: Option<u64>,
    pub error: Option<String>,
    pub finished: bool,
}

#[derive(Default)]
pub(super) struct Control {
    pub stop: bool,
    pub paused: bool,
    pub stats: RecordingStats,
}

pub struct RecordingSession {
    control: Arc<Mutex<Control>>,
    worker: Option<thread::JoinHandle<Result<(), String>>>,
    pub(crate) ready: Arc<Mutex<mpsc::Receiver<Result<(), String>>>>,
}

impl RecordingSession {
    pub fn start(plan: RecordingPlan) -> Result<Self, String> {
        let session = Self::launch(plan);
        session.wait_ready()?;
        Ok(session)
    }
    pub fn launch(plan: RecordingPlan) -> Self {
        let control = Arc::new(Mutex::new(Control::default()));
        {
            let mut state = control.lock().unwrap_or_else(|e| e.into_inner());
            state.stats.output_path = plan.path.to_string_lossy().into();
            state.stats.partial_path = temp_path(&plan.path).to_string_lossy().into();
        }
        let shared = control.clone();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            #[cfg(windows)]
            let result = windows::record(plan, &shared, &ready_tx).map_err(|error| error.to_string());
            #[cfg(not(windows))]
            let result: Result<(), String> = { let _ = plan; Err("Screen recording currently requires Windows".into()) };
            let mut state = shared.lock().unwrap_or_else(|e| e.into_inner());
            let result = result.map_err(|error| format!("{error}. Any partial recording remains at {}", state.stats.partial_path));
            state.stats.error = result.as_ref().err().cloned();
            state.stats.finished = true;
            drop(state);
            if let Err(error) = &result { let _ = ready_tx.try_send(Err(error.clone())); }
            result
        });
        Self { control, worker: Some(worker), ready: Arc::new(Mutex::new(ready_rx)) }
    }
    fn wait_ready(&self) -> Result<(), String> { Self::wait_for_ready(&self.ready) }
    pub(crate) fn wait_for_ready(ready: &Arc<Mutex<mpsc::Receiver<Result<(), String>>>>) -> Result<(), String> {
        ready.lock().map_err(|_| "Recording startup channel is unavailable".to_string())?
            .recv_timeout(Duration::from_secs(20)).map_err(|e| format!("Recording startup did not complete: {e}"))?
    }
    pub fn stats(&self) -> RecordingStats { self.control.lock().unwrap_or_else(|e| e.into_inner()).stats.clone() }
    pub fn pause(&self, paused: bool) { self.control.lock().unwrap_or_else(|e| e.into_inner()).paused = paused; }
    pub fn request_stop(&self) { self.control.lock().unwrap_or_else(|e| e.into_inner()).stop = true; }
    pub fn stop(mut self) -> Result<RecordingStats, String> {
        self.request_stop();
        if let Some(worker) = self.worker.take() { worker.join().map_err(|_| "Recording worker panicked".to_string())??; }
        Ok(self.stats())
    }
}

impl Drop for RecordingSession {
    fn drop(&mut self) { self.request_stop(); }
}

pub(super) fn temp_path(path: &Path) -> PathBuf {
    path.with_file_name(format!("{}.partial.mp4", path.file_stem().unwrap_or_default().to_string_lossy()))
}

pub(super) struct Timeline {
    last: Instant,
    elapsed: Duration,
}
impl Timeline {
    pub fn new() -> Self { Self { last: Instant::now(), elapsed: Duration::ZERO } }
    pub fn update(&mut self, paused: bool) -> Duration {
        let now = Instant::now();
        if !paused { self.elapsed += now - self.last; }
        self.last = now;
        self.elapsed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> RecordingPlan { RecordingPlan { display: "test".into(), full_display: false, x: 0, y: 0, width: 897, height: 360, output_width: 0, output_height: 0, fps: 60, bitrate: 20_000_000, software: false, cursor: true, path: "test.mp4".into() } }
    #[test]
    fn rectangle_and_padding() {
        let display = DisplayInfo { id: "test".into(), name: "test".into(), width: 1920, height: 1080, x: -1920, y: 0, hdr: false };
        let mut p = plan(); p.validate(&display).unwrap(); assert_eq!((p.output_width, p.output_height), (898,360));
        p.x = u32::MAX; assert!(p.validate(&display).is_err());
        p.full_display = true; p.validate(&display).unwrap(); assert_eq!((p.width,p.height), (1920,1080));
        p.fps = 0; assert!(p.validate(&display).is_err());
    }
    #[test]
    fn paused_time_is_excluded() {
        let mut clock = Timeline::new(); clock.last -= Duration::from_secs(2);
        assert!(clock.update(false) >= Duration::from_secs(2));
        let before = clock.elapsed; clock.last -= Duration::from_secs(5);
        assert_eq!(clock.update(true), before);
    }
}
