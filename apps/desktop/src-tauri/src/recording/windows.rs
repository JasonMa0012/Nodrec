//! Windows-only media resources stay on their owning recording/writer threads.
use super::*;
use std::{mem::ManuallyDrop, sync::mpsc::{SyncSender, TrySendError}};
use ::windows::{
    core::{factory, Error, HSTRING, Interface, PCWSTR, Result, GUID},
    Graphics::{Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession}, DirectX::{DirectXPixelFormat, Direct3D11::IDirect3DDevice}},
    Win32::{
        Foundation::{E_FAIL, E_INVALIDARG, HMODULE, RECT},
        Graphics::{Direct3D::*, Direct3D11::*, Dxgi::{*, Common::*}, Gdi::*},
        Media::MediaFoundation::*,
        Storage::FileSystem::{MoveFileExW, MOVEFILE_WRITE_THROUGH},
        UI::HiDpi::*,
        System::{Com::*, Variant::VARIANT, WinRT::{Direct3D11::*, Graphics::Capture::IGraphicsCaptureItemInterop}},
    },
};

fn failure(message: impl Into<String>) -> Error { Error::new(E_FAIL, message.into()) }
fn text16(value: &[u16]) -> String { String::from_utf16_lossy(&value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())]) }
unsafe fn attr_string(attrs: &IMFAttributes, key: &GUID) -> Result<String> {
    let mut value = vec![0u16; attrs.GetStringLength(key)? as usize + 1];
    attrs.GetString(key, &mut value, None)?;
    Ok(text16(&value))
}
struct MediaPlatform;
impl MediaPlatform {
    fn start() -> Result<Self> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()?; }
        if let Err(error) = unsafe { MFStartup(MF_VERSION, MFSTARTUP_FULL) } { unsafe { CoUninitialize(); } return Err(error); }
        Ok(Self)
    }
}
impl Drop for MediaPlatform {
    fn drop(&mut self) { unsafe { let _ = MFShutdown(); CoUninitialize(); } }
}

struct NativeDisplay { info: DisplayInfo, adapter: IDXGIAdapter1, output: IDXGIOutput }
struct PhysicalPixels(DPI_AWARENESS_CONTEXT);
impl PhysicalPixels { fn enter() -> Self { Self(unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) }) } }
impl Drop for PhysicalPixels { fn drop(&mut self) { unsafe { SetThreadDpiAwarenessContext(self.0); } } }
fn native_displays() -> Result<Vec<NativeDisplay>> {
    let _physical_pixels = PhysicalPixels::enter();
    unsafe {
        let factory: IDXGIFactory1 = CreateDXGIFactory1()?;
        let mut result = Vec::new();
        let mut ai = 0;
        loop {
            let adapter = match factory.EnumAdapters1(ai) { Ok(a) => a, Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break, Err(e) => return Err(e) };
            ai += 1;
            let mut oi = 0;
            loop {
                let output = match adapter.EnumOutputs(oi) { Ok(o) => o, Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break, Err(e) => return Err(e) };
                oi += 1;
                let desc = output.GetDesc()?;
                if !desc.AttachedToDesktop.as_bool() { continue; }
                let name = text16(&desc.DeviceName);
                let mut monitor = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
                if !EnumDisplayDevicesW(PCWSTR(desc.DeviceName.as_ptr()), 0, &mut monitor, 1).as_bool() {
                    return Err(failure(format!("Cannot identify display {name}")));
                }
                let id = text16(&monitor.DeviceID);
                if id.is_empty() { return Err(failure("Display has no stable monitor identifier")); }
                let hdr = output.cast::<IDXGIOutput6>()?.GetDesc1()?.ColorSpace == DXGI_COLOR_SPACE_RGB_FULL_G2084_NONE_P2020;
                let r = desc.DesktopCoordinates;
                result.push(NativeDisplay { info: DisplayInfo { id, name: format!("{} · {}", text16(&monitor.DeviceString), name), width: (r.right-r.left) as u32, height: (r.bottom-r.top) as u32, x: r.left, y: r.top, hdr }, adapter: adapter.clone(), output });
            }
        }
        Ok(result)
    }
}
pub fn displays() -> Result<Vec<DisplayInfo>> { Ok(native_displays()?.into_iter().map(|d| d.info).collect()) }

unsafe fn media_type(plan: &RecordingPlan, subtype: &GUID) -> Result<IMFMediaType> {
    video_media_type(plan.output_width, plan.output_height, plan.fps, subtype)
}

unsafe fn video_media_type(width: u32, height: u32, fps: u32, subtype: &GUID) -> Result<IMFMediaType> {
    let media = MFCreateMediaType()?;
    media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
    media.SetUINT64(&MF_MT_FRAME_SIZE, ((width as u64) << 32) | height as u64)?;
    media.SetUINT64(&MF_MT_FRAME_RATE, ((fps as u64) << 32) | 1)?;
    media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
    media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    media.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
    media.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
    media.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
    media.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
    Ok(media)
}

fn encoder_step<T>(name: &str, step: &str, action: impl FnOnce() -> Result<T>) -> Result<T> {
    crate::logging::write("info", "encoder", format!("{name}: {step}"));
    action().map_err(|error| {
        crate::logging::write("error", "encoder", format!("{name}: {step} failed | HRESULT=0x{:08X} | {error}", error.code().0 as u32));
        Error::new(error.code(), format!("{name}: {step}: {error}"))
    })
}

struct EncoderActivation(IMFActivate);
impl Drop for EncoderActivation {
    fn drop(&mut self) { unsafe { let _ = self.0.ShutdownObject(); } }
}

struct Encoder {
    transform: IMFTransform,
    events: Option<IMFMediaEventGenerator>,
    input_ready: u32,
    output_ready: u32,
    drained: bool,
    name: String,
    _activation: Option<EncoderActivation>,
}
impl Encoder {
    unsafe fn new(plan: &RecordingPlan, luid: u64, manager: &IMFDXGIDeviceManager) -> Result<Self> {
        crate::logging::write("info", "encoder", format!("H.264 setup | mode={} | adapter LUID=0x{luid:016X} | {}x{} @ {} fps | bitrate={} bps | input=NV12 | profile=High | GOP={} | B frames=0", if plan.software { "Software" } else { "Hardware Auto" }, plan.output_width, plan.output_height, plan.fps, plan.bitrate, plan.fps * 2));
        if plan.software {
            let transform = encoder_step("Microsoft H.264 (Software)", "activate", || CoCreateInstance::<_, IMFTransform>(&CMSH264EncoderMFT, None, CLSCTX_INPROC_SERVER))?;
            return Self::configure(plan, manager, transform, "Microsoft H.264 (Software)".into(), None);
        }
        let attrs = attributes(1)?;
        attrs.SetUINT64(&MFT_ENUM_ADAPTER_LUID, luid)?;
        let mut raw = std::ptr::null_mut();
        let mut count = 0;
        encoder_step("Hardware H.264", "enumerate capture-adapter encoders", || MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            Some(&MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 }),
            Some(&MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 }),
            &attrs, &mut raw, &mut count))?;
        let activations: Vec<_> = if raw.is_null() { vec![] } else {
            let activations = std::slice::from_raw_parts_mut(raw, count as usize).iter_mut().filter_map(Option::take).collect();
            CoTaskMemFree(Some(raw.cast()));
            activations
        };
        crate::logging::write("info", "encoder", format!("Hardware candidates: {}", activations.len()));
        let mut reasons = Vec::new();
        for activation in activations {
            let activation = EncoderActivation(activation);
            let attrs: IMFAttributes = activation.0.cast()?;
            let name = attr_string(&attrs, &MFT_FRIENDLY_NAME_Attribute).unwrap_or_else(|_| "Hardware H.264".into());
            crate::logging::write("info", "encoder", format!("Candidate: {name} | CLSID={:?}", attrs.GetGUID(&MFT_TRANSFORM_CLSID_Attribute)));
            let result = encoder_step(&name, "activate", || activation.0.ActivateObject::<IMFTransform>())
                .and_then(|transform| Self::configure(plan, manager, transform, name.clone(), Some(activation)));
            match result {
                Ok(encoder) => { crate::logging::write("info", "encoder", format!("Selected: {name}")); return Ok(encoder); },
                Err(error) => reasons.push(format!("{name}: {error}")),
            }
        }
        Err(failure(format!("No usable H.264 hardware encoder on the capture adapter. {}", reasons.join("; "))))
    }
    unsafe fn configure(plan: &RecordingPlan, manager: &IMFDXGIDeviceManager, transform: IMFTransform, name: String, activation: Option<EncoderActivation>) -> Result<Self> {
        let attrs = encoder_step(&name, "read transform attributes", || transform.GetAttributes())?;
        let asynchronous = attrs.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) != 0;
        crate::logging::write("info", "encoder", format!("{name}: asynchronous={asynchronous} | D3D11 aware={}", attrs.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0)));
        if asynchronous { encoder_step(&name, "unlock asynchronous transform", || attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1))?; }
        if !plan.software {
            if attrs.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0) == 0 { return Err(failure("Hardware encoder does not accept D3D11 surfaces")); }
            encoder_step(&name, "D3D11 device manager", || transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize))?;
        }
        let codec: ICodecAPI = encoder_step(&name, "query ICodecAPI", || transform.cast())?;
        encoder_step(&name, "CBR rate control", || codec.SetValue(&CODECAPI_AVEncCommonRateControlMode, &VARIANT::from(eAVEncCommonRateControlMode_CBR.0 as u32)))?;
        encoder_step(&name, "bitrate", || codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &VARIANT::from(plan.bitrate)))?;
        encoder_step(&name, "GOP size", || codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(plan.fps * 2)))?;
        let output = encoder_step(&name, "create H.264 media type", || media_type(plan, &MFVideoFormat_H264))?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, plan.bitrate)?;
        output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
        encoder_step(&name, "H.264 output type", || transform.SetOutputType(0, &output, 0))?;
        encoder_step(&name, "NV12 input type", || transform.SetInputType(0, &media_type(plan, &MFVideoFormat_NV12)?, 0))?;
        // Some drivers expose codec properties only after media type negotiation.
        encoder_step(&name, "disable B frames", || codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &VARIANT::from(0u32)))?;
        encoder_step(&name, "begin streaming", || transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0))?;
        encoder_step(&name, "start streaming", || transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0))?;
        let events = if asynchronous { Some(encoder_step(&name, "query asynchronous events", || transform.cast())?) } else { None };
        Ok(Self { transform, events, input_ready: 0, output_ready: 0, drained: false, name, _activation:activation })
    }
    unsafe fn poll_events(&mut self) -> Result<()> {
        if let Some(events) = &self.events {
            loop {
                let event = match events.GetEvent(MF_EVENT_FLAG_NO_WAIT) { Ok(e) => e, Err(e) if e.code() == MF_E_NO_EVENTS_AVAILABLE => break, Err(e) => return Err(e) };
                event.GetStatus()?.ok()?;
                match event.GetType()? {
                    t if t == METransformNeedInput.0 as u32 => self.input_ready += 1,
                    t if t == METransformHaveOutput.0 as u32 => self.output_ready += 1,
                    t if t == METransformDrainComplete.0 as u32 => self.drained = true,
                    _ => {}
                }
            }
        }
        Ok(())
    }
    unsafe fn output(&mut self, packets: &mut PacketOutputs) -> Result<u64> {
        let mut count = 0;
        loop {
            self.poll_events()?;
            if self.events.is_some() && self.output_ready == 0 { break; }
            let info = self.transform.GetOutputStreamInfo(0)?;
            let supplied = if info.dwFlags & MFT_OUTPUT_STREAM_PROVIDES_SAMPLES.0 as u32 == 0 {
                let sample = MFCreateSample()?;
                sample.AddBuffer(&MFCreateMemoryBuffer(info.cbSize.max(1))?)?;
                Some(sample)
            } else { None };
            let mut out = [MFT_OUTPUT_DATA_BUFFER { dwStreamID: 0, pSample: ManuallyDrop::new(supplied), ..Default::default() }];
            let mut status = 0;
            let result = self.transform.ProcessOutput(0, &mut out, &mut status);
            let sample = ManuallyDrop::take(&mut out[0].pSample);
            ManuallyDrop::drop(&mut out[0].pEvents);
            match result {
                Ok(()) => {
                    if self.events.is_some() { self.output_ready = self.output_ready.saturating_sub(1); }
                    if let Some(sample) = sample {
                        let buffer = sample.ConvertToContiguousBuffer()?;
                        let mut data = std::ptr::null_mut(); let mut length = 0;
                        buffer.Lock(&mut data, None, Some(&mut length))?;
                        if length as usize > MAX_PACKET_BYTES { buffer.Unlock()?; return Err(failure("Encoded packet exceeds 64 MiB")); }
                        let bytes: Arc<[u8]> = Arc::from(std::slice::from_raw_parts(data, length as usize));
                        buffer.Unlock()?;
                        let packet = Packet { bytes, time: sample.GetSampleTime()?, duration: sample.GetSampleDuration()?, key: sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) };
                        packets.send(packet)?;
                        count += 1;
                    }
                }
                Err(e) if e.code() == MF_E_TRANSFORM_NEED_MORE_INPUT => { if self.events.is_none() { self.drained = true; } break; }
                Err(e) => return Err(e),
            }
        }
        Ok(count)
    }
    unsafe fn input(&mut self, sample: &IMFSample) -> Result<bool> {
        self.poll_events()?;
        if self.events.is_some() && self.input_ready == 0 { return Ok(false); }
        match self.transform.ProcessInput(0, sample, 0) {
            Ok(()) => { self.input_ready = self.input_ready.saturating_sub(1); self.drained = false; Ok(true) }
            Err(e) if e.code() == MF_E_NOTACCEPTING => Ok(false),
            Err(e) => Err(e),
        }
    }
}
impl Drop for Encoder {
    fn drop(&mut self) { unsafe { let _ = self.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0); } }
}

// The generated Windows binding uses an out parameter for this constructor.
unsafe fn attributes(capacity: u32) -> Result<IMFAttributes> {
    let mut attrs = None;
    MFCreateAttributes(&mut attrs, capacity)?;
    attrs.ok_or_else(|| failure("Missing Media Foundation attributes"))
}

struct Capture {
    pool: Direct3D11CaptureFramePool,
    session: GraphicsCaptureSession,
    closed: Arc<std::sync::atomic::AtomicBool>,
    item: GraphicsCaptureItem,
    closed_token: i64,
}
impl Drop for Capture {
    fn drop(&mut self) { let _ = self.item.RemoveClosed(self.closed_token); let _ = self.session.Close(); let _ = self.pool.Close(); }
}

struct Gpu {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    video: ID3D11VideoDevice,
    video_context: ID3D11VideoContext,
    processor: ID3D11VideoProcessor,
    enumerator: ID3D11VideoProcessorEnumerator,
    crop: ID3D11Texture2D,
    input_view: ID3D11VideoProcessorInputView,
    allocator: Option<IMFVideoSampleAllocatorEx>,
    software_texture: Option<ID3D11Texture2D>,
    staging: Option<ID3D11Texture2D>,
    manager: IMFDXGIDeviceManager,
}
impl Gpu {
    unsafe fn new(plan: &RecordingPlan, adapter: &IDXGIAdapter1) -> Result<Self> {
        let mut device = None; let mut context = None;
        D3D11CreateDevice(adapter, D3D_DRIVER_TYPE_UNKNOWN, HMODULE::default(), D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
            None, D3D11_SDK_VERSION, Some(&mut device), None, Some(&mut context))?;
        let device = device.ok_or_else(|| failure("Missing D3D11 device"))?;
        let context = context.ok_or_else(|| failure("Missing D3D11 context"))?;
        let _ = context.cast::<ID3D11Multithread>()?.SetMultithreadProtected(true);
        Self::with_device(plan, device, context, None)
    }
    unsafe fn encoding_branch(&self, plan: &RecordingPlan) -> Result<Self> {
        let mut crop = D3D11_TEXTURE2D_DESC::default();
        self.crop.GetDesc(&mut crop);
        if crop.Width != plan.width || crop.Height != plan.height { return Err(failure("Encoder branch source dimensions differ from capture")); }
        Self::with_device(plan, self.device.clone(), self.context.clone(), Some(self.crop.clone()))
    }
    unsafe fn with_device(plan: &RecordingPlan, device: ID3D11Device, context: ID3D11DeviceContext, shared_crop: Option<ID3D11Texture2D>) -> Result<Self> {
        let mut token = 0; let mut manager = None;
        MFCreateDXGIDeviceManager(&mut token, &mut manager)?;
        let manager = manager.ok_or_else(|| failure("Missing DXGI device manager"))?;
        manager.ResetDevice(&device, token)?;
        let video: ID3D11VideoDevice = device.cast()?;
        let video_context: ID3D11VideoContext = context.cast()?;
        let enumerator = video.CreateVideoProcessorEnumerator(&D3D11_VIDEO_PROCESSOR_CONTENT_DESC {
            InputFrameFormat: D3D11_VIDEO_FRAME_FORMAT_PROGRESSIVE,
            InputFrameRate: DXGI_RATIONAL { Numerator: plan.fps, Denominator: 1 },
            InputWidth: plan.width, InputHeight: plan.height,
            OutputFrameRate: DXGI_RATIONAL { Numerator: plan.fps, Denominator: 1 },
            OutputWidth: plan.output_width, OutputHeight: plan.output_height,
            Usage: D3D11_VIDEO_USAGE_PLAYBACK_NORMAL,
        })?;
        let processor = video.CreateVideoProcessor(&enumerator, 0)?;
        let crop = match shared_crop { Some(crop) => crop, None => texture(&device, plan.width, plan.height, DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_BIND_RENDER_TARGET.0 as u32, false)? };
        let mut input_view = None;
        video.CreateVideoProcessorInputView(&crop, &enumerator, &D3D11_VIDEO_PROCESSOR_INPUT_VIEW_DESC {
            ViewDimension: D3D11_VPIV_DIMENSION_TEXTURE2D, ..Default::default()
        }, Some(&mut input_view))?;
        let input_view = input_view.ok_or_else(|| failure("Missing video input view"))?;
        let source = RECT { left: 0, top: 0, right: plan.width as i32, bottom: plan.height as i32 };
        let (dw, dh) = fitted_size(plan.width, plan.height, plan.output_width, plan.output_height);
        let left = ((plan.output_width - dw) / 2) as i32;
        let top = ((plan.output_height - dh) / 2) as i32;
        let dest = RECT { left, top, right: left + dw as i32, bottom: top + dh as i32 };
        video_context.VideoProcessorSetStreamSourceRect(&processor, 0, true, Some(&source));
        video_context.VideoProcessorSetStreamDestRect(&processor, 0, true, Some(&dest));
        video_context.VideoProcessorSetStreamAutoProcessingMode(&processor, 0, false);
        video_context.VideoProcessorSetOutputBackgroundColor(&processor, false, &D3D11_VIDEO_COLOR { Anonymous: D3D11_VIDEO_COLOR_0 { RGBA: D3D11_VIDEO_COLOR_RGBA { R: 0., G: 0., B: 0., A: 1. } } });
        let v1: ID3D11VideoContext1 = video_context.cast()?;
        v1.VideoProcessorSetStreamColorSpace1(&processor, 0, DXGI_COLOR_SPACE_RGB_FULL_G22_NONE_P709);
        v1.VideoProcessorSetOutputColorSpace1(&processor, DXGI_COLOR_SPACE_YCBCR_STUDIO_G22_LEFT_P709);
        let (allocator, software_texture, staging) = if plan.software {
            (None, Some(texture(&device, plan.output_width, plan.output_height, DXGI_FORMAT_NV12, D3D11_BIND_RENDER_TARGET.0 as u32, false)?),
                Some(texture(&device, plan.output_width, plan.output_height, DXGI_FORMAT_NV12, 0, true)?))
        } else {
            let mut raw = std::ptr::null_mut();
            MFCreateVideoSampleAllocatorEx(&IMFVideoSampleAllocatorEx::IID, &mut raw)?;
            let alloc = IMFVideoSampleAllocatorEx::from_raw(raw);
            alloc.SetDirectXManager(&manager)?;
            let attrs = attributes(2)?;
            attrs.SetUINT32(&MF_SA_D3D11_BINDFLAGS, D3D11_BIND_RENDER_TARGET.0 as u32)?;
            alloc.InitializeSampleAllocatorEx(3, 3, &attrs, &media_type(plan, &MFVideoFormat_NV12)?)?;
            (Some(alloc), None, None)
        };
        Ok(Self { device, context, video, video_context, processor, enumerator, crop, input_view, allocator, software_texture, staging, manager })
    }
    unsafe fn capture(&self, plan: &RecordingPlan, monitor: HMONITOR) -> Result<Capture> {
        if !GraphicsCaptureSession::IsSupported()? { return Err(failure("Windows Graphics Capture is not supported")); }
        let interop: IGraphicsCaptureItemInterop = factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?;
        #[cfg(test)] eprintln!("fault probe: WGC factory ready");
        let item: GraphicsCaptureItem = interop.CreateForMonitor(monitor)?;
        #[cfg(test)] eprintln!("fault probe: WGC item ready");
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let signal = closed.clone();
        let token = item.Closed(&::windows::Foundation::TypedEventHandler::new(move |_, _| { signal.store(true, std::sync::atomic::Ordering::Relaxed); Ok(()) }))?;
        let dxgi: IDXGIDevice = self.device.cast()?;
        let winrt: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, item.Size()?)?;
        #[cfg(test)] eprintln!("fault probe: WGC pool ready");
        let session = pool.CreateCaptureSession(&item)?;
        #[cfg(test)] eprintln!("fault probe: WGC session created");
        session.SetIsCursorCaptureEnabled(plan.cursor)?;
        session.StartCapture()?;
        #[cfg(test)] eprintln!("fault probe: WGC started");
        Ok(Capture { pool, session, closed, item, closed_token: token })
    }
    unsafe fn update(&self, capture: &Capture, plan: &RecordingPlan, display: &DisplayInfo) -> Result<u64> {
        if capture.closed.load(std::sync::atomic::Ordering::Relaxed) { return Err(failure("Capture display was disconnected or closed")); }
        let mut frames = 0;
        // At most the two WGC buffers; do not chase a producer indefinitely.
        for _ in 0..2 {
            let frame = match capture.pool.TryGetNextFrame() { Ok(f) => f, Err(e) if e.code().0 == 0 || e.code() == E_INVALIDARG || e.code().0 == 0x8000000A_u32 as i32 => break, Err(e) => return Err(e) };
            let size = frame.ContentSize()?;
            if size.Width != display.width as i32 || size.Height != display.height as i32 { frame.Close()?; return Err(failure("Display size changed during recording")); }
            let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
            let texture: ID3D11Texture2D = access.GetInterface()?;
            self.context.CopySubresourceRegion(&self.crop, 0, 0, 0, 0, &texture, 0, Some(&D3D11_BOX { left: plan.x, top: plan.y, front: 0, right: plan.x+plan.width, bottom: plan.y+plan.height, back: 1 }));
            frame.Close()?;
            frames += 1;
        }
        Ok(frames)
    }
    unsafe fn sample(&self, plan: &RecordingPlan) -> Result<Option<IMFSample>> {
        let sample = if let Some(allocator) = &self.allocator {
            match allocator.AllocateSample() { Ok(sample) => sample, Err(e) if e.code() == MF_E_SAMPLEALLOCATOR_EMPTY => return Ok(None), Err(e) => return Err(e) }
        } else { MFCreateSample()? };
        let (texture, subresource) = if plan.software { (self.software_texture.as_ref().unwrap().clone(), 0) } else {
            let buffer: IMFDXGIBuffer = sample.GetBufferByIndex(0)?.cast()?;
            let mut raw = std::ptr::null_mut(); buffer.GetResource(&ID3D11Texture2D::IID, &mut raw)?;
            (ID3D11Texture2D::from_raw(raw), buffer.GetSubresourceIndex()?)
        };
        let mut output = None;
        self.video.CreateVideoProcessorOutputView(&texture, &self.enumerator, &D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC {
            ViewDimension: D3D11_VPOV_DIMENSION_TEXTURE2DARRAY,
            Anonymous: D3D11_VIDEO_PROCESSOR_OUTPUT_VIEW_DESC_0 { Texture2DArray: D3D11_TEX2D_ARRAY_VPOV { MipSlice: 0, FirstArraySlice: subresource, ArraySize: 1 } },
        }, Some(&mut output))?;
        let mut stream = D3D11_VIDEO_PROCESSOR_STREAM { Enable: true.into(), pInputSurface: ManuallyDrop::new(Some(self.input_view.clone())), ..Default::default() };
        let result = self.video_context.VideoProcessorBlt(&self.processor, output.as_ref().unwrap(), 0, std::slice::from_ref(&stream));
        ManuallyDrop::drop(&mut stream.pInputSurface);
        result?;
        // Submit video processing before the asynchronous encoder reads its texture.
        self.context.Flush();
        if plan.software {
            let staging = self.staging.as_ref().unwrap();
            self.context.CopyResource(staging, &texture);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            self.context.Map(staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
            let bytes = plan.output_width * plan.output_height * 3 / 2;
            let copied = (|| -> Result<IMFMediaBuffer> {
                let buffer = MFCreateMemoryBuffer(bytes)?;
                let mut dest = std::ptr::null_mut(); buffer.Lock(&mut dest, None, None)?;
                for row in 0..plan.output_height * 3 / 2 {
                    std::ptr::copy_nonoverlapping((mapped.pData as *const u8).add((row*mapped.RowPitch) as usize), dest.add((row*plan.output_width) as usize), plan.output_width as usize);
                }
                buffer.Unlock()?; buffer.SetCurrentLength(bytes)?; Ok(buffer)
            })();
            self.context.Unmap(staging, 0);
            sample.AddBuffer(&copied?)?;
        }
        Ok(Some(sample))
    }
}

unsafe fn texture(device: &ID3D11Device, width: u32, height: u32, format: DXGI_FORMAT, bind: u32, staging: bool) -> Result<ID3D11Texture2D> {
    let mut result = None;
    device.CreateTexture2D(&D3D11_TEXTURE2D_DESC { Width: width, Height: height, MipLevels: 1, ArraySize: 1, Format: format,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 }, Usage: if staging { D3D11_USAGE_STAGING } else { D3D11_USAGE_DEFAULT },
        BindFlags: bind, CPUAccessFlags: if staging { D3D11_CPU_ACCESS_READ.0 as u32 } else { 0 }, MiscFlags: 0 }, None, Some(&mut result))?;
    result.ok_or_else(|| failure("D3D11 texture creation returned no texture"))
}
fn fitted_size(w: u32, h: u32, ow: u32, oh: u32) -> (u32,u32) {
    if ow == (w+1)&!1 && oh == (h+1)&!1 { return (w,h); }
    let scale = (ow as f64 / w as f64).min(oh as f64 / h as f64);
    ((w as f64*scale).round().clamp(1., ow as f64) as u32, (h as f64*scale).round().clamp(1., oh as f64) as u32)
}

const MAX_PACKET_BYTES: usize = 64 * 1024 * 1024;
#[cfg(test)]
#[derive(Clone, Copy)]
enum RecordingFault { Writer, SlowWriter, Encoder, HardwareSetup }
#[cfg(test)]
static RECORDING_FAULT: std::sync::Mutex<Option<(PathBuf,RecordingFault)>> = std::sync::Mutex::new(None);
#[cfg(test)]
fn recording_fault(path: &Path) -> Option<RecordingFault> {
    RECORDING_FAULT.lock().unwrap().as_ref().filter(|(target,_)|target == path).map(|(_,fault)|*fault)
}
struct PacketPermit { budget: Arc<std::sync::atomic::AtomicUsize>, bytes: usize }
impl PacketPermit {
    fn reserve(budget: &Arc<std::sync::atomic::AtomicUsize>, bytes: usize) -> Result<Self> {
        use std::sync::atomic::Ordering;
        budget.try_update(Ordering::AcqRel, Ordering::Acquire, |used| used.checked_add(bytes).filter(|total| *total <= MAX_PACKET_BYTES))
            .map_err(|_| failure("MP4 writer cannot keep up; encoded packet memory exceeds 64 MiB"))?;
        Ok(Self { budget: budget.clone(), bytes })
    }
}
impl Drop for PacketPermit {
    fn drop(&mut self) { self.budget.fetch_sub(self.bytes, std::sync::atomic::Ordering::AcqRel); }
}
#[derive(Clone)]
struct Packet { bytes: Arc<[u8]>, time: i64, duration: i64, key: u32 }
struct QueuedPacket { packet: Packet, _permit: PacketPermit }
struct PacketWriter {
    budget: Arc<std::sync::atomic::AtomicUsize>,
    sender: Option<SyncSender<QueuedPacket>>,
    worker: Option<thread::JoinHandle<Result<()>>>,
}
impl PacketWriter {
    fn send(&self, packet: Packet) -> Result<()> {
        let permit = PacketPermit::reserve(&self.budget, packet.bytes.len())?;
        let queued = QueuedPacket { packet, _permit: permit };
        match self.sender.as_ref().ok_or_else(|| failure("MP4 writer is closed"))?.try_send(queued) {
            Ok(()) => Ok(()),
            Err(TrySendError::Full(_)) => Err(failure("MP4 writer cannot keep up; encoded packet queue is full")),
            Err(TrySendError::Disconnected(_)) => Err(failure("MP4 writer failed")),
        }
    }
    fn finish(mut self) -> Result<()> {
        self.sender.take();
        self.worker.take().unwrap().join().map_err(|_| failure("MP4 writer panicked"))?
    }
}
impl Drop for PacketWriter {
    fn drop(&mut self) { self.sender.take(); if let Some(worker) = self.worker.take() { let _ = worker.join(); } }
}
#[derive(Clone)]
struct EncodedVideoFormat {
    codec: String,
    width: u32,
    height: u32,
    fps: u32,
    bitrate: u32,
    header: Vec<u8>,
}

struct EncoderBranch {
    failed: bool,
    encoder: Encoder,
    gpu: Gpu,
    plan: RecordingPlan,
    outputs: PacketOutputs,
    next_tick: u64,
    fresh: bool,
}
#[derive(Default)]
struct BranchTick { encoded: u64, dropped: u64, repeated: u64 }
impl EncoderBranch {
    unsafe fn tick(&mut self, elapsed: Duration, paused: bool, frames: u64) -> Result<BranchTick> {
        #[cfg(test)]
        if matches!(recording_fault(&self.plan.path),Some(RecordingFault::Encoder)) && self.next_tick >= 30 { return Err(failure("Injected encoder failure")); }
        self.fresh |= frames > 0;
        let mut stats = BranchTick { encoded:self.encoder.output(&mut self.outputs)?, ..Default::default() };
        if paused { return Ok(stats); }
        let tick = (elapsed.as_nanos() * self.plan.fps as u128 / 1_000_000_000) as u64;
        if tick < self.next_tick || (self.encoder.events.is_some() && self.encoder.input_ready == 0) { return Ok(stats); }
        if let Some(sample) = self.gpu.sample(&self.plan)? {
            let time = (tick as u128 * 10_000_000 / self.plan.fps as u128) as i64;
            let end = ((tick as u128+1) * 10_000_000 / self.plan.fps as u128) as i64;
            sample.SetSampleTime(time)?;
            sample.SetSampleDuration(end-time)?;
            if self.encoder.input(&sample)? {
                stats.dropped = tick.saturating_sub(self.next_tick);
                stats.repeated = u64::from(!self.fresh);
                self.fresh = false;
                self.next_tick = tick+1;
            }
        }
        Ok(stats)
    }
}

struct PacketOutputs {
    encoder_error: Option<String>,
    paths: Vec<PathBuf>,
    writers: Vec<PacketWriter>,
    errors: Vec<String>,
}
impl PacketOutputs {
    fn fail_all(&mut self, error: &str) {
        crate::logging::write("error", "encoder", format!("Branch failed | outputs={:?} | {error}", self.paths));
        self.encoder_error = Some(error.to_string());
        for (index, writer) in self.writers.iter_mut().enumerate() {
            writer.sender.take();
            self.errors.push(format!("Output {}: encoder failed: {error}",index+1));
        }
    }
    fn stats(&self, finished: bool) -> Vec<OutputStats> {
        self.paths.iter().enumerate().map(|(index,path)| {
            let prefix = format!("Output {}",index+1);
            let errors: Vec<_> = self.errors.iter().filter(|error| error.strip_prefix(&prefix).is_some_and(|suffix| suffix.starts_with(':' ) || suffix.starts_with(' '))).cloned().collect();
            OutputStats { encoder_error:self.encoder_error.clone(), path:path.to_string_lossy().into(),partial_path:temp_path(path).to_string_lossy().into(),finished,error:if errors.is_empty(){None}else{Some(errors.join("; "))} }
        }).collect()
    }
    fn send(&mut self, packet: Packet) -> Result<()> {
        let mut delivered = 0;
        for (index, writer) in self.writers.iter_mut().enumerate() {
            if writer.sender.is_none() { continue; }
            match writer.send(packet.clone()) {
                Ok(()) => delivered += 1,
                Err(error) => {
                    self.errors.push(format!("Output {}: {error}", index + 1));
                    writer.sender.take();
                }
            }
        }
        if delivered == 0 { return Err(failure(format!("All recording outputs failed: {}", self.errors.join("; ")))); }
        Ok(())
    }
    fn finish(&mut self, publish: bool) -> Result<()> {
        for (index, writer) in self.writers.drain(..).enumerate() {
                        let failed = self.errors.iter().any(|error| error.starts_with(&format!("Output {}:",index+1)));
            match writer.finish() {
                Err(error) => self.errors.push(format!("Output {} completion: {error}",index+1)),
                Ok(()) if publish && !failed => if let Some(path) = self.paths.get(index) {
                    if let Err(error) = unsafe { MoveFileExW(&HSTRING::from(temp_path(path).as_os_str()), &HSTRING::from(path.as_os_str()), MOVEFILE_WRITE_THROUGH) } {
                        self.errors.push(format!("Output {} could not publish {}: {error}",index+1,path.display()));
                    }
                },
                _ => {}
            }
        }
        if self.errors.is_empty() { Ok(()) } else { Err(failure(self.errors.join("; "))) }
    }
}

impl EncodedVideoFormat {
    fn validate_mp4(&self) -> Result<()> {
        if self.codec != "h264" { return Err(failure("MP4 writer currently supports only H.264 packets")); }
        if self.width == 0 || self.height == 0 || self.fps == 0 { return Err(failure("Encoded video dimensions and frame rate must be positive")); }
        Ok(())
    }
}

fn writer(output_path: PathBuf, format: EncodedVideoFormat, packets: mpsc::Receiver<QueuedPacket>, ready: SyncSender<std::result::Result<(),String>>) -> Result<()> {
    let _platform = MediaPlatform::start()?;
    let result = unsafe {
        (|| -> Result<()> {
            format.validate_mp4()?;
            let path = temp_path(&output_path);
            let output_type = video_media_type(format.width, format.height, format.fps, &MFVideoFormat_H264)?;
            output_type.SetUINT32(&MF_MT_AVG_BITRATE, format.bitrate)?;
            output_type.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
            if !format.header.is_empty() { output_type.SetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &format.header)?; }
            let stream = MFCreateFile(MF_ACCESSMODE_WRITE, MF_OPENMODE_FAIL_IF_EXIST, MF_FILEFLAGS_NONE, &HSTRING::from(path.as_os_str()))?;
            let sink = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), &stream, None)?;
            let index = sink.AddStream(&output_type)?;
            sink.SetInputMediaType(index, &output_type, None)?;
            sink.BeginWriting()?;
            let _ = ready.send(Ok(()));
            let write_result = (|| -> Result<()> {
                #[cfg(test)]
                let mut packet_count = 0;
                while let Ok(queued) = packets.recv() {
                    #[cfg(test)]
                    {
                        packet_count += 1;
                        if packet_count == 30 {
                            match recording_fault(&output_path) {
                                Some(RecordingFault::Writer) => return Err(failure("Injected writer failure")),
                                Some(RecordingFault::SlowWriter) => thread::sleep(Duration::from_secs(4)),
                                _ => {}
                            }
                        }
                    }
                    let packet = &queued.packet;
                    let sample = MFCreateSample()?;
                    let buffer = MFCreateMemoryBuffer(packet.bytes.len() as u32)?;
                    let mut data = std::ptr::null_mut(); buffer.Lock(&mut data, None, None)?;
                    std::ptr::copy_nonoverlapping(packet.bytes.as_ptr(), data, packet.bytes.len());
                    buffer.Unlock()?; buffer.SetCurrentLength(packet.bytes.len() as u32)?;
                    sample.AddBuffer(&buffer)?; sample.SetSampleTime(packet.time)?; sample.SetSampleDuration(packet.duration)?;
                    sample.SetUINT32(&MFSampleExtension_CleanPoint, packet.key)?;
                    sink.WriteSample(index, &sample)?;
                }
                Ok(())
            })();
            let finalized = sink.Finalize().map_err(|e| failure(format!("Finalize: {e}")));
            drop(sink);
            drop(stream);
            write_result.map_err(|e| failure(format!("WriteSample: {e}")))?; finalized?;
            Ok(())
        })()
    };
    if let Err(e) = &result { crate::logging::write("error", "writer", format!("{} | HRESULT=0x{:08X} | {e}", output_path.display(), e.code().0 as u32)); let _ = ready.try_send(Err(e.to_string())); }
    result
}

pub fn record(mut plan: RecordingPlan, mut groups: Vec<(RecordingPlan,Vec<PathBuf>)>, control: &Arc<Mutex<Control>>, ready: &SyncSender<std::result::Result<(),String>>) -> Result<()> {
    let paths: Vec<_> = groups.iter().flat_map(|(_,paths)| paths.iter().cloned()).collect();
    if paths.is_empty() { return Err(failure("Recording has no output paths")); }
    super::validate_output_paths(&paths).map_err(failure)?;
    for path in &paths {
        std::fs::create_dir_all(path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."))).map_err(|e| failure(e.to_string()))?;
        if path.exists() || temp_path(path).exists() { return Err(failure(format!("Recording output already exists: {}",path.display()))); }
    }
    let _platform = MediaPlatform::start()?;
    let displays = native_displays()?;
    #[cfg(test)] eprintln!("fault probe: platform and displays ready");
    let matches: Vec<_> = displays.iter().filter(|d| d.info.id == plan.display).collect();
    let display = if matches.len() == 1 { matches[0] } else if plan.display == "Display 1" && displays.len() == 1 { &displays[0] }
        else { return Err(failure("Display is missing or ambiguous; select a display again")); };
    plan.validate(&display.info).map_err(failure)?;
    for (branch, paths) in &mut groups {
        branch.validate(&display.info).map_err(failure)?;
        if paths.is_empty() || !plan.same_source(branch) { return Err(failure("Encoding branches require the same capture source and at least one output")); }
    }
    std::fs::create_dir_all(plan.path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."))).map_err(|e| failure(e.to_string()))?;
    if plan.path.exists() { return Err(failure("Output file already exists; choose a unique filename")); }
    unsafe {
        let gpu = Gpu::new(&plan, &display.adapter).map_err(|e| failure(format!("D3D11 setup: {e}")))?;
        #[cfg(test)] eprintln!("fault probe: capture device ready");
        let source_gpu = gpu;
        let capture = source_gpu.capture(&plan, display.output.GetDesc()?.Monitor).map_err(|e| failure(format!("WGC setup: {e}")))?;
        #[cfg(test)] eprintln!("fault probe: capture session ready");
        let mut branches = Vec::new();
        let desc = display.adapter.GetDesc1()?;
        crate::logging::write("info", "capture", format!("Adapter={} | display={} | region={},{} {}x{} | cursor={}", text16(&desc.Description), display.info.name, plan.x, plan.y, plan.width, plan.height, plan.cursor));
        let luid = ((desc.AdapterLuid.HighPart as u32 as u64) << 32) | desc.AdapterLuid.LowPart as u64;
        let mut failed_outputs = Vec::new();
        let mut failed_writers = Vec::new();
        let mut initialization_errors = Vec::new();
        for (mut plan, paths) in groups {
        let failure_paths = paths.clone();
        let mut encoder_initializing = true;
        let initialized = (|| -> Result<EncoderBranch> {
        plan.validate(&display.info).map_err(failure)?;
        let create = |plan: &RecordingPlan| -> Result<(Gpu, Encoder)> {
            #[cfg(test)]
            if !plan.software && matches!(recording_fault(&plan.path), Some(RecordingFault::HardwareSetup)) { return Err(failure("Injected hardware setup failure")); }
            let gpu = source_gpu.encoding_branch(plan)?;
            let encoder = Encoder::new(plan, luid, &gpu.manager)?;
            Ok((gpu, encoder))
        };
        let (gpu, encoder) = match create(&plan) {
            Ok(resources) => resources,
            Err(error) if !plan.software => {
                crate::logging::write("warn", "encoder", format!("Hardware setup failed; falling back to CPU: {error}"));
                plan.software = true;
                create(&plan).map_err(|cpu| failure(format!("Hardware: {error}; CPU fallback: {cpu}")))?
            }
            Err(error) => return Err(error),
        };
        #[cfg(test)] eprintln!("fault probe: encoder ready");

        let output_type = encoder.transform.GetOutputCurrentType(0)?;
        let mut header = vec![0u8; output_type.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER).unwrap_or(0) as usize];
        if !header.is_empty() { output_type.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut header, None)?; }
        let format = EncodedVideoFormat { codec: "h264".into(), width: plan.output_width, height: plan.output_height, fps: plan.fps, bitrate: plan.bitrate, header };
        encoder_initializing = false;
        let mut packet_outputs = PacketOutputs { encoder_error:None, paths:paths.clone(), writers:vec![], errors:vec![] };
        for path in &paths {
            let (packet_tx, packet_rx) = mpsc::sync_channel((plan.fps*2) as usize);
            let (writer_tx, writer_rx) = mpsc::sync_channel(1);
            let path = path.clone();
            let format = format.clone();
            let worker = thread::spawn(move || writer(path, format, packet_rx, writer_tx));
            packet_outputs.writers.push(PacketWriter { sender:Some(packet_tx), worker:Some(worker), budget:Arc::new(std::sync::atomic::AtomicUsize::new(0)) });
            let initialized = writer_rx.recv_timeout(Duration::from_secs(10)).map_err(|error| error.to_string()).and_then(|result| result);
            if let Err(error) = initialized {
                let index = packet_outputs.writers.len()-1;
                packet_outputs.errors.push(format!("Output {}: {error}",index+1));
                packet_outputs.writers[index].sender.take();
            }
        }
        if packet_outputs.writers.iter().all(|writer| writer.sender.is_none()) { return Err(failure(format!("All outputs failed during startup: {}",packet_outputs.errors.join("; ")))); }
        Ok(EncoderBranch {encoder,gpu,plan,outputs:packet_outputs,next_tick:0,fresh:true,failed:false})
        })();
        match initialized {
            Ok(branch) => branches.push(branch),
            Err(error) => {
                crate::logging::write("error", "recording", format!("Branch initialization failed | outputs={failure_paths:?} | HRESULT=0x{:08X} | {error}", error.code().0 as u32));
                initialization_errors.push(error.to_string());
                failed_outputs.extend(failure_paths.iter().map(|path|OutputStats{encoder_error:encoder_initializing.then(||error.to_string()),path:path.to_string_lossy().into(),partial_path:temp_path(path).to_string_lossy().into(),finished:true,error:Some(error.to_string())}));
            }
        }
        }
        if branches.is_empty() {
            control.lock().unwrap_or_else(|error|error.into_inner()).stats.outputs = failed_outputs;
            return Err(failure(format!("All encoders failed: {}",initialization_errors.join("; "))));
        }
        let first_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if control.lock().unwrap_or_else(|e| e.into_inner()).stop { return Err(failure("Recording cancelled during startup")); }
            if source_gpu.update(&capture, &plan, &display.info)? > 0 { break; }
            if Instant::now() >= first_deadline { return Err(failure("Capture did not produce a frame")); }
            thread::sleep(Duration::from_millis(2));
        }
        {
            let mut state = control.lock().unwrap_or_else(|e| e.into_inner());
            state.stats = RecordingStats { encoder: branches.iter().map(|branch|branch.encoder.name.as_str()).collect::<Vec<_>>().join(", "), adapter: text16(&desc.Description), width: plan.output_width, height: plan.output_height, fps: plan.fps, output_path: plan.path.to_string_lossy().into(), partial_path: temp_path(&plan.path).to_string_lossy().into(), ..Default::default() };
        }

        let mut clock = Timeline::new();
        let _ = ready.send(Ok(()));
        let run_result = (|| -> Result<()> {
            loop {
                let (stop, paused) = { let c = control.lock().unwrap_or_else(|e| e.into_inner()); (c.stop,c.paused) };
                if stop { break; }
                let elapsed = clock.update(paused);
                let frames = source_gpu.update(&capture, &plan, &display.info)?;
                for branch in &mut branches {
                if branch.failed { continue; }
                let tick = match branch.tick(elapsed,paused,frames) {
                    Ok(tick) => tick,
                    Err(error) => {
                        branch.failed = true;
                        branch.outputs.fail_all(&error.to_string());
                        continue;
                    }
                };
                {
                    let mut c = control.lock().unwrap_or_else(|error| error.into_inner());
                    c.stats.encoded_frames += tick.encoded;
                    c.stats.duration_ms = elapsed.as_millis() as u64;
                    c.stats.dropped_frames += frames.saturating_sub(1) + tick.dropped;
                    c.stats.repeated_frames += tick.repeated;
                    c.stats.outputs = branch.outputs.stats(false);
                }
                }
                for branch in branches.extract_if(.., |branch| branch.failed) { failed_writers.push(branch.outputs); }
                control.lock().unwrap_or_else(|error|error.into_inner()).stats.outputs = branches.iter().flat_map(|branch|branch.outputs.stats(false)).chain(failed_writers.iter().flat_map(|outputs|outputs.stats(false))).chain(failed_outputs.iter().cloned()).collect();
                if branches.is_empty() { return Err(failure("All encoding branches failed")); }
                thread::sleep(Duration::from_millis(if paused {5} else {1}));
            }
            Ok(())
        })();
        let stopped_at = Instant::now();
        drop(capture);
        let mut errors = initialization_errors;
        for branch in &mut branches {
        let drain_result = (|| -> Result<()> {
            if branch.failed { return Err(failure("Encoder branch failed during recording")); }
            branch.encoder.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            branch.encoder.transform.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
            branch.encoder.drained = false;
            loop {
                let count = branch.encoder.output(&mut branch.outputs)?;
                control.lock().unwrap_or_else(|e| e.into_inner()).stats.encoded_frames += count;
                if branch.encoder.drained { break; }
                if stopped_at.elapsed() > Duration::from_secs(10) { return Err(failure("H.264 encoder drain timed out")); }
                thread::sleep(Duration::from_millis(1));
            }
            Ok(())
        })();
        let written = branch.outputs.finish(run_result.is_ok() && drain_result.is_ok());
        control.lock().unwrap_or_else(|error| error.into_inner()).stats.outputs = branch.outputs.stats(true);
        if let Err(error) = drain_result { errors.push(format!("Encoder drain: {error}")); }
        if let Err(error) = written { errors.push(format!("MP4 completion: {error}")); }
        }
        for outputs in &mut failed_writers { if let Err(error) = outputs.finish(false) { errors.push(error.to_string()); } }
        control.lock().unwrap_or_else(|error| error.into_inner()).stats.outputs = branches.iter().flat_map(|branch|branch.outputs.stats(true)).chain(failed_writers.iter().flat_map(|outputs|outputs.stats(true))).chain(failed_outputs.iter().cloned()).collect();
        control.lock().unwrap_or_else(|e| e.into_inner()).stats.stop_ms = Some(stopped_at.elapsed().as_millis() as u64);
        run_result?;
        if !errors.is_empty() { return Err(failure(errors.join("; "))); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoder_diagnostics_preserve_hresult_and_failed_operation() {
        let result: Result<()> = encoder_step("test encoder", "test configuration", || Err(Error::new(E_INVALIDARG, "unsupported value")));
        let error = result.unwrap_err();
        assert_eq!(error.code(), E_INVALIDARG);
        assert!(error.to_string().contains("test configuration"));
        assert!(crate::logging::entries().iter().any(|entry| entry.level == "error" && entry.message.contains("test encoder: test configuration failed | HRESULT=0x80070057")));
    }

    #[test]
    #[ignore = "Requires a connected SDR display and hardware H.264 encoder"]
    fn live_recording_fault_isolation() {
        use crate::recording::RecordingSession;
        struct TestApartment;
        impl Drop for TestApartment { fn drop(&mut self) { unsafe { CoUninitialize(); } } }
        unsafe { CoInitializeEx(None,COINIT_MULTITHREADED).ok().unwrap(); }
        let _apartment = TestApartment;
        struct ResetFault;
        impl Drop for ResetFault { fn drop(&mut self) { *RECORDING_FAULT.lock().unwrap() = None; } }
        let _reset = ResetFault;
        let display = displays().unwrap().remove(0);
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target").join(format!("live-recording-faults-{}",std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()));
        std::fs::create_dir_all(&directory).unwrap();
        for (name,fault,separate) in [("writer-shared",RecordingFault::Writer,false),("writer-separate",RecordingFault::Writer,true),("slow-writer",RecordingFault::SlowWriter,false),("encoder",RecordingFault::Encoder,true)] {
            eprintln!("fault probe case: {name}");
            let healthy = directory.join(format!("{name}-healthy.mp4"));
            let failed = directory.join(format!("{name}-failed.mp4"));
            let mut plan = RecordingPlan {display:display.id.clone(),full_display:false,x:0,y:0,width:897,height:360,output_width:0,output_height:0,fps:60,bitrate:20_000_000,software:false,cursor:true,path:healthy.clone()};
            plan.validate(&display).unwrap();
            *RECORDING_FAULT.lock().unwrap() = Some((failed.clone(),fault));
            let mut second = plan.clone(); second.path = failed.clone();
            let groups = if separate { vec![(plan.clone(),vec![healthy.clone()]),(second,vec![failed.clone()])] } else { vec![(plan.clone(),vec![healthy.clone(),failed.clone()])] };
            let session = RecordingSession::start_graph(plan,groups).unwrap();
            thread::sleep(Duration::from_secs(if matches!(fault,RecordingFault::SlowWriter) {3} else {1}));
            let during = session.stats();
            assert!(!during.finished,"Healthy recording ended with {name}: {during:?}");
            assert!(during.outputs.iter().any(|output|PathBuf::from(&output.path)==failed && output.error.is_some()),"Fault was not observed: {during:?}");
            thread::sleep(Duration::from_secs(1));
            assert!(session.stats().encoded_frames > during.encoded_frames,"Healthy encoder stopped progressing after {name}");
            session.request_stop();
            let deadline = Instant::now()+Duration::from_secs(15);
            while !session.stats().finished && Instant::now()<deadline { thread::sleep(Duration::from_millis(10)); }
            let stats = session.stats();
            assert!(stats.finished,"Faulted session failed to stop: {name}");
            assert!(session.stop().is_err());
            assert!(healthy.is_file() && !failed.exists() && temp_path(&failed).is_file());
            assert!(stats.outputs.iter().find(|output|PathBuf::from(&output.path)==healthy).unwrap().error.is_none());
            if matches!(fault,RecordingFault::SlowWriter) { assert!(stats.outputs.iter().any(|output|output.error.as_ref().is_some_and(|error|error.contains("queue is full")))); }
            std::fs::write(directory.join(format!("{name}.json")),serde_json::to_vec_pretty(&stats).unwrap()).unwrap();
        }
        let failed = directory.join("all-outputs-failed.mp4");
        *RECORDING_FAULT.lock().unwrap() = Some((failed.clone(),RecordingFault::Writer));
        let mut plan = RecordingPlan {display:display.id.clone(),full_display:false,x:0,y:0,width:897,height:360,output_width:0,output_height:0,fps:60,bitrate:20_000_000,software:false,cursor:true,path:failed.clone()};
        plan.validate(&display).unwrap();
        let session = RecordingSession::start(plan).unwrap();
        let deadline = Instant::now()+Duration::from_secs(10);
        while !session.stats().finished && Instant::now()<deadline { thread::sleep(Duration::from_millis(10)); }
        let stats = session.stats();
        assert!(stats.finished && stats.error.is_some(),"All failed outputs must stop capture");
        assert!(session.stop().is_err());
        assert!(!failed.exists() && temp_path(&failed).is_file());
        std::fs::write(directory.join("all-outputs-failed.json"),serde_json::to_vec_pretty(&stats).unwrap()).unwrap();
        *RECORDING_FAULT.lock().unwrap() = None;
        let fallback = directory.join("cpu-fallback.mp4");
        *RECORDING_FAULT.lock().unwrap() = Some((fallback.clone(),RecordingFault::HardwareSetup));
        let plan = RecordingPlan {display:display.id.clone(),full_display:false,x:0,y:0,width:897,height:360,output_width:0,output_height:0,fps:60,bitrate:20_000_000,software:false,cursor:true,path:fallback.clone()};
        let session = RecordingSession::start(plan).unwrap();
        thread::sleep(Duration::from_secs(1));
        let stats = session.stop().unwrap();
        assert!(stats.encoder.contains("Software") && stats.encoded_frames > 0 && fallback.is_file(), "CPU fallback did not produce a recording: {stats:?}");
        std::fs::write(directory.join("cpu-fallback.json"),serde_json::to_vec_pretty(&stats).unwrap()).unwrap();
        println!("Live fault artifacts: {}",directory.display());
    }
    #[test]
    fn encoder_failure_closes_and_marks_only_its_outputs() {
        use std::sync::atomic::AtomicUsize;
        let (sender, receiver) = mpsc::sync_channel(1);
        let writer = PacketWriter {sender:Some(sender),worker:None,budget:Arc::new(AtomicUsize::new(0))};
        let mut outputs = PacketOutputs {encoder_error:None,paths:vec!["failed.mp4".into()],writers:vec![writer],errors:vec![]};
        outputs.fail_all("device lost");
        assert!(receiver.recv().is_err());
        assert!(outputs.stats(false)[0].error.as_ref().unwrap().contains("device lost"));
        assert_eq!(outputs.stats(false)[0].encoder_error.as_deref(), Some("device lost"));
        assert!(outputs.writers[0].sender.is_none());
    }
    #[test]
    fn fanout_isolates_full_writers_and_fails_only_when_all_outputs_fail() {
        use std::sync::atomic::AtomicUsize;
        let (slow_tx, _slow_rx) = mpsc::sync_channel(0);
        let (healthy_tx, healthy_rx) = mpsc::sync_channel(2);
        let make = |sender| PacketWriter { sender:Some(sender),worker:None,budget:Arc::new(AtomicUsize::new(0)) };
        let mut outputs = PacketOutputs { encoder_error:None, paths:vec!["slow.mp4".into(),"healthy.mp4".into()], writers:vec![make(slow_tx),make(healthy_tx)],errors:vec![] };
        let packet = Packet {bytes:Arc::from([1u8]),time:0,duration:1,key:1};
        outputs.send(packet.clone()).unwrap();
        assert!(outputs.writers[0].sender.is_none());
        assert_eq!(outputs.errors.len(),1);
        let stats = outputs.stats(false);
        assert!(stats[0].error.is_some());
        assert!(stats[1].error.is_none());
        assert_eq!(healthy_rx.recv().unwrap().packet.bytes.as_ref(), &[1]);
        outputs.send(packet.clone()).unwrap();
        drop(healthy_rx);
        assert!(outputs.send(packet).is_err());
        assert_eq!(outputs.errors.len(),2);
    }
    #[test]
    fn writers_share_packet_bytes_but_keep_independent_queue_budgets() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let (first_tx, first_rx) = mpsc::sync_channel(1);
        let (second_tx, second_rx) = mpsc::sync_channel(1);
        let first = PacketWriter { sender:Some(first_tx),worker:None,budget:Arc::new(AtomicUsize::new(0)) };
        let second = PacketWriter { sender:Some(second_tx),worker:None,budget:Arc::new(AtomicUsize::new(0)) };
        let packet = Packet { bytes:Arc::from([1u8,2,3]),time:0,duration:1,key:1 };
        first.send(packet.clone()).unwrap();
        second.send(packet.clone()).unwrap();
        assert!(first.send(packet.clone()).is_err());
        assert_eq!(first.budget.load(Ordering::Acquire),3);
        let queued = second_rx.recv().unwrap();
        assert!(Arc::ptr_eq(&queued.packet.bytes,&packet.bytes));
        drop(queued);
        assert_eq!(second.budget.load(Ordering::Acquire),0);
        second.send(packet).unwrap();
        drop(first_rx);
        assert_eq!(first.budget.load(Ordering::Acquire),0);
    }
    #[test]
    fn mp4_accepts_only_supported_encoded_formats() {
        let mut format = EncodedVideoFormat { codec: "h264".into(), width:1920, height:1080, fps:60, bitrate:20_000_000, header:vec![] };
        assert!(format.validate_mp4().is_ok());
        format.codec = "hevc".into();
        assert!(format.validate_mp4().is_err());
        format.codec = "h264".into();
        format.fps = 0;
        assert!(format.validate_mp4().is_err());
    }
    #[test]
    fn packet_budget_is_bounded_and_released_on_drop() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let budget = Arc::new(AtomicUsize::new(0));
        let permit = PacketPermit::reserve(&budget, MAX_PACKET_BYTES).unwrap();
        assert!(PacketPermit::reserve(&budget, 1).is_err());
        assert!(PacketPermit::reserve(&budget, usize::MAX).is_err());
        drop(permit);
        assert_eq!(budget.load(Ordering::Acquire), 0);
        assert!(PacketPermit::reserve(&budget, 1).is_ok());
    }
    #[test] fn aspect_and_odd_padding() { assert_eq!(fitted_size(897,360,898,360), (897,360)); assert_eq!(fitted_size(1000,1000,1920,1080), (1080,1080)); }
}
