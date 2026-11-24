//! Session-scoped raw input and presentation-time indexes for opted-in MP4 writers.
use super::{Control, DisplayInfo, OutputStats, RecordingPlan};
use ::windows::{
    core::{w, HSTRING},
    Win32::{
        Foundation::{HWND, POINT},
        Media::MediaFoundation::*,
        Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
        UI::{
            Input::{KeyboardAndMouse::GetAsyncKeyState, *},
            WindowsAndMessaging::*,
        },
    },
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeSet, HashMap},
    fs::File,
    io::{self, BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
};

fn line(out: &mut impl Write, row: &Value) -> io::Result<()> {
    serde_json::to_writer(&mut *out, row)?;
    out.write_all(b"\n")
}

const MOUSE_COLUMNS: &[&str] = &[
    "t",
    "seq",
    "device",
    "x",
    "y",
    "cursor_px",
    "message_ms",
    "flags",
    "raw_wparam",
    "queue_delay_ms",
    "button_flags",
    "button_data",
    "raw_buttons",
    "extra",
    "wheel",
];
const KEY_COLUMNS: &[&str] = &[
    "t",
    "seq",
    "device",
    "scan",
    "vk",
    "flags",
    "up",
    "message",
    "message_ms",
    "raw_wparam",
    "queue_delay_ms",
    "extra",
    "reserved",
];

fn defaults() -> Value {
    json!({"flags":0,"raw_wparam":0,"queue_delay_ms":0,"button_flags":0,"button_data":0,"raw_buttons":0,"extra":0,"wheel":null,"reserved":0})
}

fn compact_event(mut row: Value, defaults: &Value) -> Value {
    let columns = match row["type"].as_str() {
        Some("mouse") => MOUSE_COLUMNS,
        Some("key") => KEY_COLUMNS,
        _ => return row,
    };
    let fields = row.as_object_mut().unwrap();
    // Keep an object verbatim if a producer adds fields before the column schema is updated.
    if fields.len() != columns.len() + 1 || columns.iter().any(|key| !fields.contains_key(*key)) {
        return row;
    }
    let mut values = vec![fields.remove("type").unwrap()];
    for key in columns {
        values.push(fields.remove(*key).unwrap());
    }
    while values.len() > 1 && defaults.get(columns[values.len() - 2]) == values.last() {
        values.pop();
    }
    Value::Array(values)
}

fn artifact_paths(video: &Path, extension: &str) -> (PathBuf, PathBuf) {
    let partial = format!("{}.partial.jsonl", extension.trim_end_matches(".jsonl"));
    (video.with_extension(extension), video.with_extension(partial))
}

pub(super) fn preflight(inputs: &[PathBuf], videos: &[PathBuf]) -> Result<(), String> {
    for path in inputs {
        if !videos.contains(path) {
            return Err(format!(
                "Input events require a matching video writer: {}",
                path.display()
            ));
        }
        for extension in ["input.jsonl", "frames.jsonl"] {
            let (final_path, partial) = artifact_paths(path, extension);
            for file in [final_path, partial] {
                if file.try_exists().map_err(|e| e.to_string())? {
                    return Err(format!("Recording output already exists: {}", file.display()));
                }
            }
        }
    }
    Ok(())
}

struct Artifact {
    path: PathBuf,
    partial: PathBuf,
    writer: BufWriter<File>,
}
impl Artifact {
    fn create(video: &Path, extension: &str, header: Option<&Value>) -> io::Result<Self> {
        let (path, partial) = artifact_paths(video, extension);
        if path.try_exists()? {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                path.display().to_string(),
            ));
        }
        let mut writer = BufWriter::new(File::create_new(&partial)?);
        if let Some(header) = header {
            line(&mut writer, header)?;
        }
        Ok(Self {
            path,
            partial,
            writer,
        })
    }
    fn publish(mut self, result: Result<(), String>) -> OutputStats {
        let result = self.writer.flush().map_err(|e| e.to_string()).and(result);
        drop(self.writer);
        let result = result.and_then(|_| unsafe {
            MoveFileExW(
                &HSTRING::from(self.partial.as_os_str()),
                &HSTRING::from(self.path.as_os_str()),
                MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|e| e.to_string())
        });
        OutputStats {
            path: self.path.display().to_string(),
            partial_path: self.partial.display().to_string(),
            finished: result.is_ok(),
            error: result.err(),
            encoder_error: None,
        }
    }
}

pub(super) struct Pair {
    video: PathBuf,
    events: Artifact,
    frames: Artifact,
    error: Option<String>,
}
pub(super) type Captured = (Vec<Pair>, Result<(), String>);
pub(super) struct Capture {
    stop: Arc<AtomicBool>,
    reader: JoinHandle<Result<(), String>>,
    writer: JoinHandle<Vec<Pair>>,
}
impl Capture {
    pub fn start(
        paths: &[PathBuf],
        branches: &[(&RecordingPlan, Vec<OutputStats>)],
        display: &DisplayInfo,
        control: Arc<Mutex<Control>>,
        failed: &mut Vec<OutputStats>,
    ) -> Option<Self> {
        if paths.is_empty() {
            return None;
        }
        let session = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_string();
        let mut pairs = Vec::new();
        for video in paths {
            let Some((plan, _)) = branches.iter().find(|(_, stats)| {
                stats
                    .iter()
                    .any(|s| Path::new(&s.path) == video && s.error.is_none())
            }) else {
                continue;
            };
            let header = json!({"type":"header","version":2,"columns":{"mouse":MOUSE_COLUMNS,"key":KEY_COLUMNS},"defaults":defaults(),"session":session,"video":video.file_name().unwrap_or_default().to_string_lossy(),
                "reader_guide":{
                    "input.jsonl":"After the header, read records in file order, including ties. For [kind, ...values], map values to columns[kind] in order and fill omitted trailing fields from defaults. Read object records as written. For a session time range, select start <= t < end in 100 ns ticks (10,000,000 per second).",
                    "frames.jsonl":"After the header, each row is one video frame, numbered from 0 in display order. Map values to columns. Read bytes [byte_start, byte_end) from the beginning of the matching .input.jsonl in binary mode, then decode those bytes as UTF-8 JSONL. Equal offsets mean no records. Add session_shift to frame start and end to compare with input t."
                },
                "time_unit":"100ns","clock":"session_active_receive_time","region_xywh":[i64::from(display.x)+i64::from(plan.x),i64::from(display.y)+i64::from(plan.y),plan.width,plan.height],
                "output_size":[plan.output_width,plan.output_height],"interval":"[start,end)","offset_unit":"utf8_bytes","state_keys":["device","scan","extended_flags","side_specific_vk"]});
            let create = || -> io::Result<Pair> {
                Ok(Pair {
                    video: video.clone(),
                    events: Artifact::create(video, "input.jsonl", Some(&header))?,
                    frames: Artifact::create(video, "frames.jsonl", None)?,
                    error: None,
                })
            };
            match create() {
                Ok(pair) => pairs.push(pair),
                Err(error) => {
                    for extension in ["input.jsonl", "frames.jsonl"] {
                        let (path, partial) = artifact_paths(video, extension);
                        failed.push(OutputStats {
                            path: path.display().to_string(),
                            partial_path: partial.display().to_string(),
                            finished: false,
                            error: Some(format!("Cannot initialize input files: {error}")),
                            encoder_error: None,
                        });
                    }
                }
            }
        }
        if pairs.is_empty() {
            return None;
        }
        let (tx, rx) = mpsc::sync_channel::<Value>(16384);
        let (ready, started) = mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        let signal = stop.clone();
        let reader = thread::spawn(move || unsafe { listen(control, signal, tx, ready) });
        if started.recv().is_err() {
            let error = reader
                .join()
                .ok()
                .and_then(Result::err)
                .unwrap_or_else(|| "Raw input listener failed to start".into());
            for pair in pairs {
                failed.push(pair.events.publish(Err(error.clone())));
                failed.push(pair.frames.publish(Err(error.clone())));
            }
            return None;
        }
        let writer = thread::spawn(move || {
            let defaults = defaults();
            for row in rx {
                let row = compact_event(row, &defaults);
                for pair in &mut pairs {
                    if pair.error.is_none() {
                        if let Err(e) = line(&mut pair.events.writer, &row) {
                            pair.error = Some(e.to_string());
                        }
                    }
                }
            }
            pairs
        });
        Some(Self { stop, reader, writer })
    }
    pub fn stop(self) -> Captured {
        self.stop.store(true, Ordering::Release);
        let result = self
            .reader
            .join()
            .unwrap_or_else(|_| Err("Input thread panicked".into()));
        (self.writer.join().expect("input writer thread panicked"), result)
    }
}

#[derive(Default)]
struct State {
    keys: BTreeSet<(u32, u16, u16, u16)>,
    buttons: BTreeSet<(u32, u16)>,
    unknown_vk: BTreeSet<u16>,
}
impl State {
    fn snapshot(&self, t: u64) -> Value {
        json!({"type":"state","t":t,"keys":self.keys,"buttons":self.buttons,"unassigned_vk":self.unknown_vk})
    }
    fn apply(&mut self, device: u32, raw: &RAWINPUT) -> Value {
        unsafe {
            if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
                let k = raw.data.keyboard;
                let vk = match (k.VKey, k.MakeCode, k.Flags & 2 != 0) {
                    (16, 0x36, _) => 0xa1,
                    (16, _, _) => 0xa0,
                    (17, _, true) => 0xa3,
                    (17, _, false) => 0xa2,
                    (18, _, true) => 0xa5,
                    (18, _, false) => 0xa4,
                    _ => k.VKey,
                };
                let key = (device, k.MakeCode, k.Flags & 6, vk);
                let up = k.Flags & 1 != 0;
                self.keys.retain(|old| {
                    !(old.0 == device && old.1 == key.1 && old.2 == key.2 && (key.1 != 0 || old.3 == vk))
                });
                if !up {
                    self.keys.insert(key);
                }
                self.unknown_vk.remove(&vk);
                json!({"type":"key","scan":k.MakeCode,"flags":k.Flags,"vk":k.VKey,"up":up,"message":k.Message,"reserved":k.Reserved,"extra":k.ExtraInformation})
            } else {
                let m = raw.data.mouse;
                let b = m.Anonymous.Anonymous;
                for i in 0..5 {
                    let key = (device, i + 1);
                    if b.usButtonFlags & (1 << (2 * i)) != 0 {
                        self.buttons.insert(key);
                    }
                    if b.usButtonFlags & (2 << (2 * i)) != 0 {
                        self.buttons.remove(&key);
                    }
                    if b.usButtonFlags & (3 << (2 * i)) != 0 {
                        self.unknown_vk.remove(&[1, 2, 4, 5, 6][i as usize]);
                    }
                }
                let mut cursor = POINT::default();
                let position = GetPhysicalCursorPos(&mut cursor)
                    .ok()
                    .map(|_| [cursor.x, cursor.y]);
                json!({"type":"mouse","flags":m.usFlags.0,"x":m.lLastX,"y":m.lLastY,"button_flags":b.usButtonFlags,
                    "button_data":b.usButtonData,"wheel":if b.usButtonFlags & 0xc00 != 0 {Some(b.usButtonData as i16)} else {None},
                    "raw_buttons":m.ulRawButtons,"extra":m.ulExtraInformation,"cursor_px":position})
            }
        }
    }
}

pub(super) fn held_virtual_keys() -> std::collections::BTreeSet<u16> {
    (1..=254)
        .filter(|vk| !matches!(vk, 16..=18) && unsafe { GetAsyncKeyState(*vk as i32) } < 0)
        .collect()
}

unsafe fn listen(
    control: Arc<Mutex<Control>>,
    stop: Arc<AtomicBool>,
    tx: SyncSender<Value>,
    ready: SyncSender<()>,
) -> Result<(), String> {
    // Windows routes each raw device class to one window per process.
    static OWNER: Mutex<()> = Mutex::new(());
    let _owner = OWNER
        .try_lock()
        .map_err(|_| "Another session is already recording desktop input".to_string())?;
    let hwnd = CreateWindowExW(
        Default::default(),
        w!("STATIC"),
        None,
        Default::default(),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        None,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;
    let devices = |flags, target| {
        [2, 6].map(|usage| RAWINPUTDEVICE {
            usUsagePage: 1,
            usUsage: usage,
            dwFlags: flags,
            hwndTarget: target,
        })
    };
    let size = size_of::<RAWINPUTDEVICE>() as u32;
    RegisterRawInputDevices(&devices(RIDEV_INPUTSINK | RIDEV_DEVNOTIFY, hwnd), size)
        .map_err(|e| e.to_string())?;
    let _ = ready.send(());
    let result = (|| {
        let mut ids = HashMap::from([(0usize, 0u32)]);
        let mut next_device = 1u32;
        let mut seq = 0u64;
        let mut segment = None;
        let mut second = 0;
        let mut state = State::default();
        let send = |row| {
            tx.try_send(row).map_err(|e| match e {
                TrySendError::Full(_) => "Input queue overflow; recording incomplete".to_string(),
                TrySendError::Disconnected(_) => "Input writer disconnected".into(),
            })
        };
        loop {
            let mut msg = MSG::default();
            let message = PeekMessageW(&mut msg, Some(hwnd), 0, 0, PM_REMOVE).as_bool();
            let stamp = {
                let mut c = control.lock().unwrap();
                if c.stop || stop.load(Ordering::Acquire) {
                    break;
                }
                let generation = c.segment;
                let boundary = c.segment_start_ms;
                let baseline = if !c.paused && segment != Some(generation) {
                    c.input_baseline.clone()
                } else {
                    None
                };
                if c.paused {
                    None
                } else {
                    c.timeline.as_mut().map(|clock| {
                        (
                            generation,
                            boundary,
                            baseline,
                            (clock.update(false).as_nanos() / 100) as u64,
                        )
                    })
                }
            };
            let processed = (|| -> Result<(), String> {
                let Some((generation, boundary, baseline, t)) = stamp else {
                    return Ok(());
                };
                if let Some((start, held)) = baseline {
                    state = State {
                        unknown_vk: held,
                        ..Default::default()
                    };
                    send(state.snapshot(start))?;
                    segment = Some(generation);
                    second = t / 10_000_000;
                }
                if !message || !matches!(msg.message, WM_INPUT | WM_INPUT_DEVICE_CHANGE) {
                    return Ok(());
                }
                // A backlog from the paused segment can still be in the window queue after resume.
                let now = ::windows::Win32::System::SystemInformation::GetTickCount64();
                let age = ((now as u32).wrapping_sub(msg.time) as i32).max(0) as u64;
                if now.saturating_sub(age) < boundary {
                    return Ok(());
                }
                let mut raw = RAWINPUT::default();
                let handle = if msg.message == WM_INPUT {
                    let mut bytes = size_of::<RAWINPUT>() as u32;
                    if GetRawInputData(
                        HRAWINPUT(msg.lParam.0 as _),
                        RID_INPUT,
                        Some((&mut raw as *mut RAWINPUT).cast()),
                        &mut bytes,
                        size_of::<RAWINPUTHEADER>() as u32,
                    ) == u32::MAX
                    {
                        return Err(format!(
                            "Read raw input: {}",
                            ::windows::core::Error::from_thread()
                        ));
                    }
                    if ![RIM_TYPEMOUSE.0, RIM_TYPEKEYBOARD.0].contains(&raw.header.dwType) {
                        return Ok(());
                    }
                    raw.header.hDevice.0 as usize
                } else {
                    msg.lParam.0 as usize
                };
                let device = *ids.entry(handle).or_insert_with(|| {
                    let id = next_device;
                    next_device += 1;
                    id
                });
                if second != t / 10_000_000 {
                    send(state.snapshot(t))?;
                    second = t / 10_000_000;
                }
                if msg.message == WM_INPUT
                    && raw.header.dwType == RIM_TYPEKEYBOARD.0
                    && raw.data.keyboard.MakeCode == 0xff
                {
                    return Err("Keyboard reported an input overrun".into());
                }
                let mut row = if msg.message == WM_INPUT {
                    let mut report = state.apply(device, &raw);
                    report["raw_wparam"] = json!(raw.header.wParam.0);
                    report
                } else {
                    let removed = msg.wParam.0 == GIDC_REMOVAL as usize;
                    if removed {
                        ids.remove(&handle);
                        state.keys.retain(|k| k.0 != device);
                        state.buttons.retain(|b| b.0 != device);
                    }
                    json!({"type":"device","removed":removed})
                };
                row["device"] = json!(device);
                row["t"] = json!(t);
                row["seq"] = json!(seq);
                row["message_ms"] = json!(msg.time);
                row["queue_delay_ms"] = json!(age);
                seq += 1;
                send(row)
            })();
            if message {
                DispatchMessageW(&msg);
            }
            processed?;
            if !message {
                MsgWaitForMultipleObjectsEx(None, 4, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
            }
        }
        Ok(())
    })();
    let _ = RegisterRawInputDevices(&devices(RIDEV_REMOVE, HWND::default()), size);
    let _ = DestroyWindow(hwnd);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn input_init_collision_keeps_the_existing_file_and_reports_both_artifacts() {
        let dir = std::env::temp_dir().join(format!(
            "nodrec-input-init-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let video = dir.join("record.mp4");
        let display = DisplayInfo {
            id: "display".into(),
            name: "display".into(),
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            hdr: false,
        };
        let plan = RecordingPlan {
            display: display.id.clone(),
            full_display: true,
            x: 0,
            y: 0,
            width: 320,
            height: 180,
            output_width: 320,
            output_height: 180,
            fps: 30,
            bitrate: 2_000_000,
            software: true,
            cursor: true,
            path: video.clone(),
        };
        let output = OutputStats {
            path: video.display().to_string(),
            partial_path: String::new(),
            finished: false,
            error: None,
            encoder_error: None,
        };
        let paths = std::slice::from_ref(&video);
        preflight(paths, paths).unwrap();
        let index = video.with_extension("frames.jsonl");
        std::fs::write(&index, b"reserved").unwrap();
        let mut failed = Vec::new();
        assert!(Capture::start(
            paths,
            &[(&plan, vec![output])],
            &display,
            Default::default(),
            &mut failed
        )
        .is_none());
        assert_eq!(failed.len(), 2);
        assert!(failed.iter().all(|s| s.error.is_some()));
        assert_eq!(std::fs::read(&index).unwrap(), b"reserved");
        assert!(preflight(paths, paths).is_err());
        std::fs::remove_file(index).unwrap();
        std::fs::remove_file(video.with_extension("input.partial.jsonl")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn chords_repeats_and_identical_keys_from_two_devices() {
        let mut state = State::default();
        let mut report = RAWINPUT::default();
        report.header.dwType = RIM_TYPEKEYBOARD.0;
        for (device, scan, vk, flags, count) in [
            (1, 42, 16, 0, 1),
            (1, 30, 65, 0, 2),
            (1, 30, 65, 0, 2),
            (2, 30, 65, 0, 3),
            (1, 30, 65, 1, 2),
            (1, 42, 16, 1, 1),
            (2, 30, 65, 1, 0),
        ] {
            report.data.keyboard = RAWKEYBOARD {
                MakeCode: scan,
                VKey: vk,
                Flags: flags,
                ..Default::default()
            };
            let row = state.apply(device, &report);
            assert_eq!(row["up"], flags & 1 != 0);
            assert_eq!(state.keys.len(), count);
        }
        report.header.dwType = RIM_TYPEMOUSE.0;
        report.data.mouse = RAWMOUSE {
            lLastX: -13,
            lLastY: 2,
            Anonymous: RAWMOUSE_0 {
                Anonymous: RAWMOUSE_0_0 {
                    usButtonFlags: 0x405,
                    usButtonData: (-120i16) as u16,
                },
            },
            ..Default::default()
        };
        let row = state.apply(2, &report);
        assert_eq!(row["wheel"], -120);
        assert_eq!(row["x"], -13);
        assert_eq!(state.buttons.len(), 2);
    }
    #[test]
    #[ignore = "Measures the local 8 kHz report-processing and JSONL write path in release mode"]
    fn high_rate_reports() {
        let mut raw = RAWINPUT::default();
        raw.header.dwType = RIM_TYPEMOUSE.0;
        raw.data.mouse = RAWMOUSE {
            lLastX: 1,
            ..Default::default()
        };
        let mut state = State::default();
        let (tx, rx) = mpsc::sync_channel::<Value>(16384);
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("input-rate-{}.jsonl", std::process::id()));
        let mut out = BufWriter::new(File::create_new(&path).unwrap());
        let start = std::time::Instant::now();
        let writer = thread::spawn(move || {
            let defaults = defaults();
            for row in rx {
                line(&mut out, &compact_event(row, &defaults)).unwrap();
            }
            out.flush().unwrap();
        });
        for i in 0..32000 {
            let mut row = state.apply(1, &raw);
            row["t"] = json!(i * 1250);
            row["seq"] = json!(i);
            row["device"] = json!(1);
            row["message_ms"] = json!(i / 8);
            row["raw_wparam"] = json!(0);
            row["queue_delay_ms"] = json!(0);
            tx.send(row).unwrap();
        }
        drop(tx);
        writer.join().unwrap();
        let elapsed = start.elapsed();
        for (i, line) in BufReader::new(File::open(&path).unwrap()).lines().enumerate() {
            let row: Value = serde_json::from_str(&line.unwrap()).unwrap();
            assert_eq!(row[0], "mouse");
            assert_eq!(row[2], i);
        }
        assert_eq!(BufReader::new(File::open(&path).unwrap()).lines().count(), 32000);
        eprintln!(
            "Report conversion and JSONL writing: {:.0} reports/s",
            32000. / elapsed.as_secs_f64()
        );
        assert!(elapsed < std::time::Duration::from_secs(4));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn compact_reports_preserve_interior_defaults_and_unknown_fields() {
        for (kind, columns) in [("key", KEY_COLUMNS), ("mouse", MOUSE_COLUMNS)] {
            let defaults = defaults();
            let mut row = json!({"type":kind});
            for key in columns {
                row[*key] = defaults.get(*key).cloned().unwrap_or(json!(17));
            }
            row["extra"] = json!(42);
            let packed = compact_event(row.clone(), &defaults);
            assert_eq!(packed[0], kind);
            for (i, key) in columns.iter().enumerate() {
                assert_eq!(packed.get(i + 1).or_else(|| defaults.get(*key)), row.get(*key));
            }
            row["new_field"] = json!(null);
            assert_eq!(compact_event(row.clone(), &defaults), row);
        }
    }

    #[test]
    fn frame_slices_match_time_filter_including_ties_and_empty_frames() {
        let mut bytes = Vec::new();
        line(&mut bytes, &json!({"video":"录制.mp4"})).unwrap();
        for (seq, t) in [0, 3, 3, 5, 8, 19, 21].into_iter().enumerate() {
            line(&mut bytes, &json!({"t":t,"seq":seq})).unwrap();
        }
        let mut rows = Vec::new();
        index(
            &[
                (2, 1),
                (3, 2),
                (5, 1),
                (6, 1),
                (7, 12),
                (19, 1),
                (20, 1),
                (21, 1),
                (22, 1),
            ],
            bytes.as_slice(),
            bytes.len() as u64,
            2,
            &mut rows,
        )
        .unwrap();
        for row in rows
            .lines()
            .skip(1)
            .map(|s| serde_json::from_str::<Value>(&s.unwrap()).unwrap())
        {
            let slice = &bytes[row[2].as_u64().unwrap() as usize..row[3].as_u64().unwrap() as usize];
            let expected: Vec<_> = bytes
                .lines()
                .map(Result::unwrap)
                .filter(|s| {
                    let r: Value = serde_json::from_str(s).unwrap();
                    r["t"].as_i64().is_some_and(|t| {
                        t >= (row[0].as_i64().unwrap() + 2) && t < (row[1].as_i64().unwrap() + 2)
                    })
                })
                .collect();
            assert_eq!(slice.lines().map(Result::unwrap).collect::<Vec<_>>(), expected);
        }
    }
}

fn video_times(video: &Path) -> ::windows::core::Result<Vec<(i64, i64)>> {
    unsafe {
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(video.as_os_str()), None)?;
        let stream = MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32;
        let mut times = Vec::new();
        loop {
            let (mut flags, mut t, mut sample) = (0, 0, None);
            reader.ReadSample(stream, 0, None, Some(&mut flags), Some(&mut t), Some(&mut sample))?;
            if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 {
                return Err(::windows::core::Error::new(
                    ::windows::Win32::Foundation::E_FAIL,
                    "MP4 sample read failed",
                ));
            }
            if let Some(sample) = sample {
                times.push((t, sample.GetSampleDuration()?));
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
                break;
            }
        }
        times.sort_unstable();
        Ok(times)
    }
}

fn index(
    times: &[(i64, i64)],
    mut events: impl BufRead,
    file_size: u64,
    origin_shift: i64,
    frames: &mut impl Write,
) -> io::Result<()> {
    let mut offset = 0u64;
    let mut bytes = Vec::new();
    offset += events.read_until(b'\n', &mut bytes)? as u64;
    let mut header: Value = serde_json::from_slice(&bytes)?;
    header
        .as_object_mut()
        .ok_or_else(|| io::Error::other("Invalid event header"))?
        .remove("columns");
    header.as_object_mut().unwrap().remove("defaults");
    header["columns"] = json!(["start", "end", "byte_start", "byte_end"]);
    header["session_shift"] = json!(origin_shift);
    line(frames, &header)?;
    let mut next = || -> io::Result<Option<(u64, i64)>> {
        bytes.clear();
        if events.read_until(b'\n', &mut bytes)? == 0 {
            return Ok(None);
        }
        let start = offset;
        offset += bytes.len() as u64;
        let row: Value = serde_json::from_slice(&bytes)?;
        let t = row
            .get(1)
            .or_else(|| row.get("t"))
            .and_then(Value::as_i64)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "Missing input timestamp"))?;
        Ok(Some((start, t)))
    };
    let mut pending = next()?;
    for (i, &(start, duration)) in times.iter().enumerate() {
        let end = times.get(i + 1).map_or(start + duration, |v| v.0);
        while pending.is_some_and(|(_, t)| t < start + origin_shift) {
            pending = next()?;
        }
        let first = pending.map_or(file_size, |v| v.0);
        while pending.is_some_and(|(_, t)| t < end + origin_shift) {
            pending = next()?;
        }
        let last = pending.map_or(file_size, |v| v.0);
        line(frames, &json!([start, end, first, last]))?;
    }
    Ok(())
}

pub(super) fn finish(
    (pairs, capture): Captured,
    outputs: &[OutputStats],
    origins: &HashMap<PathBuf, i64>,
) -> Vec<OutputStats> {
    let mut stats = Vec::new();
    for mut pair in pairs {
        let video = pair.video.display().to_string();
        let mut input_result = capture
            .clone()
            .and_then(|_| pair.error.take().map_or(Ok(()), Err));
        if let Err(e) = &input_result {
            let _ = line(&mut pair.events.writer, &json!({"type":"gap","reason":e}));
        }
        if let Err(e) = pair.events.writer.flush() {
            input_result = Err(e.to_string());
        }
        let index_result = input_result.clone().and_then(|_| {
            if !outputs
                .iter()
                .any(|o| o.path == video && o.finished && o.error.is_none())
            {
                return Err("Video was not finalized".into());
            }
            let times = video_times(&pair.video).map_err(|e| e.to_string())?;
            let file = File::open(&pair.events.partial).map_err(|e| e.to_string())?;
            let size = file.metadata().map_err(|e| e.to_string())?.len();
            let first = times.first().ok_or("Video contains no timed samples")?.0;
            let origin = origins
                .get(&pair.video)
                .ok_or("Missing encoded video time origin")?
                - first;
            index(
                &times,
                BufReader::new(file),
                size,
                origin,
                &mut pair.frames.writer,
            )
            .map_err(|e| e.to_string())
        });
        let events = pair.events.publish(input_result);
        let frames = pair
            .frames
            .publish(index_result.and_then(|_| events.error.clone().map_or(Ok(()), Err)));
        stats.extend([events, frames]);
    }
    stats
}
