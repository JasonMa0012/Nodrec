//! Real-device probe: cargo run --example recording-smoke -- <path.mp4> [seconds] [software] [odd|1080|1440]
use nodrec_desktop_lib::recording::{displays, RecordingPlan, RecordingSession};
use std::{time::Duration, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().collect();
    if args.get(1).is_some_and(|s| s == "verify") { return verify(args.get(2).ok_or("Missing MP4 path")?); }
    let displays = displays()?;
    println!("{}", serde_json::to_string_pretty(&displays)?);
    if args.len() < 2 { return Ok(()); }
    let display = displays.first().ok_or("No connected display")?;
    let size = args.get(4).map(String::as_str).unwrap_or("odd");
    let mut plan = RecordingPlan { display: display.id.clone(), full_display: size != "odd", x: 0, y: 0,
        width: 897, height: 360, output_width: if size == "1080" {1920} else if size == "1440" {2560} else {0},
        output_height: if size == "1080" {1080} else if size == "1440" {1440} else {0},
        fps: 60, bitrate: 20_000_000, software: args.get(3).is_some_and(|v| v == "software"), cursor: true,
        path: PathBuf::from(&args[1]) };
    plan.validate(display)?;
    let session = RecordingSession::start(plan)?;
    for second in 0..args.get(2).map_or(Ok(3), |s| s.parse::<u32>())? {
        std::thread::sleep(Duration::from_secs(1));
        if args.iter().any(|a| a == "pause") && second == 1 { session.pause(true); std::thread::sleep(Duration::from_secs(2)); session.pause(false); }
        let stats = session.stats();
        println!("{}", serde_json::to_string(&stats)?);
        if stats.finished { return Err(stats.error.unwrap_or("Recorder exited early".into()).into()); }
    }
    let stats = session.stop()?;
    assert!(stats.encoded_frames > 0);
    println!("{}", serde_json::to_string_pretty(&stats)?);
    Ok(())
}

#[cfg(windows)]
fn verify(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    use windows::{core::HSTRING, Win32::{Media::MediaFoundation::*, System::Com::*}};
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        MFStartup(MF_VERSION, MFSTARTUP_FULL)?;
        let mut attrs = None;
        MFCreateAttributes(&mut attrs, 1)?;
        let attrs = attrs.unwrap();
        attrs.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)?;
        let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path), &attrs)?;
        let native = reader.GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, 0)?;
        assert_eq!(native.GetGUID(&MF_MT_SUBTYPE)?, MFVideoFormat_H264);
        let size = native.GetUINT64(&MF_MT_FRAME_SIZE)?;
        let media = MFCreateMediaType()?;
        media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        reader.SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, None, &media)?;
        let mut frames = 0; let mut last = -1i64; let mut first = 0i64;
        let mut last_hash = None; let mut changes = 0; let mut sample_written = false;
        loop {
            let mut flags = 0; let mut time = 0; let mut sample = None;
            reader.ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, 0, None, Some(&mut flags), Some(&mut time), Some(&mut sample))?;
            if flags & MF_SOURCE_READERF_ERROR.0 as u32 != 0 { return Err("Decoder reported an error".into()); }
            if let Some(sample) = sample {
                assert!(time >= last, "nonmonotonic video timestamps");
                assert!(sample.GetTotalLength()? > 0);
                let buffer = sample.ConvertToContiguousBuffer()?;
                let mut pixels = std::ptr::null_mut(); let mut pixel_bytes = 0;
                buffer.Lock(&mut pixels, None, Some(&mut pixel_bytes))?;
                let pixels = std::slice::from_raw_parts(pixels, pixel_bytes as usize);
                let hash = pixels.chunks_exact(4).step_by(64).fold(0u64, |hash,p| hash.wrapping_mul(31).wrapping_add(p[0] as u64 + ((p[1] as u64)<<8) + ((p[2] as u64)<<16)));
                if last_hash.is_some_and(|previous| previous != hash) { changes += 1; }
                last_hash = Some(hash);
                buffer.Unlock()?;
                if frames == 0 || (!sample_written && time-first >= 5_000_000) {
                    let buffer = sample.ConvertToContiguousBuffer()?;
                    let mut data = std::ptr::null_mut(); let mut length = 0;
                    buffer.Lock(&mut data, None, Some(&mut length))?;
                    let bytes = std::slice::from_raw_parts(data, length as usize).to_vec();
                    buffer.Unlock()?;
                    let width = (size>>32) as u32; let height = size as u32;
                    let stride = reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)?.GetUINT32(&MF_MT_DEFAULT_STRIDE).unwrap_or(width*4) as i32;
                    let mut bmp = Vec::new();
                    bmp.extend(b"BM"); bmp.extend((54+width*height*4).to_le_bytes()); bmp.extend([0u8;4]); bmp.extend(54u32.to_le_bytes());
                    bmp.extend(40u32.to_le_bytes()); bmp.extend(width.to_le_bytes()); bmp.extend((-(height as i32)).to_le_bytes());
                    bmp.extend(1u16.to_le_bytes()); bmp.extend(32u16.to_le_bytes()); bmp.extend([0u8;24]);
                    for y in 0..height {
                        let row = if stride < 0 { height-1-y } else {y};
                        let start = row as usize * stride.unsigned_abs() as usize;
                        bmp.extend(&bytes[start..start+width as usize*4]);
                    }
                    let suffix = if frames == 0 { "first" } else { sample_written = true; "sample" };
                    std::fs::write(format!("{path}.{suffix}.bmp"), bmp)?;
                }
                if frames == 0 { first = time; }
                last = time; frames += 1;
            }
            if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 { break; }
        }
        assert!(frames > 0);
        println!("Decoded H.264 MP4 {}x{}: {frames} frames, first={first}, last={last} (100 ns), sceneChanges={changes}", size>>32, size&0xffffffff);
        drop(reader); MFShutdown()?; CoUninitialize();
    }
    Ok(())
}
#[cfg(not(windows))]
fn verify(_: &str) -> Result<(), Box<dyn std::error::Error>> { Err("Windows required".into()) }
