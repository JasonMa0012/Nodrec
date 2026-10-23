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
    let media = MFCreateMediaType()?;
    media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
    media.SetGUID(&MF_MT_SUBTYPE, subtype)?;
    media.SetUINT64(&MF_MT_FRAME_SIZE, ((plan.output_width as u64) << 32) | plan.output_height as u64)?;
    media.SetUINT64(&MF_MT_FRAME_RATE, ((plan.fps as u64) << 32) | 1)?;
    media.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1)?;
    media.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32)?;
    media.SetUINT32(&MF_MT_VIDEO_PRIMARIES, MFVideoPrimaries_BT709.0 as u32)?;
    media.SetUINT32(&MF_MT_TRANSFER_FUNCTION, MFVideoTransFunc_709.0 as u32)?;
    media.SetUINT32(&MF_MT_YUV_MATRIX, MFVideoTransferMatrix_BT709.0 as u32)?;
    media.SetUINT32(&MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_16_235.0 as u32)?;
    Ok(media)
}

struct Encoder {
    transform: IMFTransform,
    events: Option<IMFMediaEventGenerator>,
    input_ready: u32,
    output_ready: u32,
    drained: bool,
    name: String,
}
impl Encoder {
    unsafe fn new(plan: &RecordingPlan, luid: u64, manager: &IMFDXGIDeviceManager) -> Result<Self> {
        let (transform, name) = if plan.software {
            (CoCreateInstance::<_, IMFTransform>(&CMSH264EncoderMFT, None, CLSCTX_INPROC_SERVER)?, "Microsoft H.264 (Software)".into())
        } else {
            let attrs = attributes(1)?;
            attrs.SetUINT64(&MFT_ENUM_ADAPTER_LUID, luid)?;
            let mut raw = std::ptr::null_mut();
            let mut count = 0;
            MFTEnum2(MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
                Some(&MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_NV12 }),
                Some(&MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 }),
                &attrs, &mut raw, &mut count)?;
            let mut selected = None;
            let mut reasons = Vec::new();
            if !raw.is_null() {
                for activation in std::slice::from_raw_parts_mut(raw, count as usize) {
                    if let Some(activation) = activation.take() {
                        let attrs: IMFAttributes = activation.cast()?;
                        let name = attr_string(&attrs, &MFT_FRIENDLY_NAME_Attribute).unwrap_or_else(|_| "Hardware H.264".into());
                        if selected.is_none() {
                            match activation.ActivateObject::<IMFTransform>() { Ok(t) => selected = Some((t, name)), Err(e) => reasons.push(e.to_string()) }
                        }
                    }
                }
                CoTaskMemFree(Some(raw.cast()));
            }
            selected.ok_or_else(|| failure(format!("No H.264 hardware encoder on the capture adapter. Select Software explicitly. {}", reasons.join("; "))))?
        };
        let attrs = transform.GetAttributes()?;
        let asynchronous = attrs.GetUINT32(&MF_TRANSFORM_ASYNC).unwrap_or(0) != 0;
        if asynchronous { attrs.SetUINT32(&MF_TRANSFORM_ASYNC_UNLOCK, 1)?; }
        if !plan.software {
            if attrs.GetUINT32(&MF_SA_D3D11_AWARE).unwrap_or(0) == 0 { return Err(failure("Hardware encoder does not accept D3D11 surfaces")); }
            transform.ProcessMessage(MFT_MESSAGE_SET_D3D_MANAGER, manager.as_raw() as usize)?;
        }
        let codec: ICodecAPI = transform.cast()?;
        codec.SetValue(&CODECAPI_AVEncCommonRateControlMode, &VARIANT::from(eAVEncCommonRateControlMode_CBR.0 as u32))?;
        codec.SetValue(&CODECAPI_AVEncCommonMeanBitRate, &VARIANT::from(plan.bitrate))?;
        codec.SetValue(&CODECAPI_AVEncMPVGOPSize, &VARIANT::from(plan.fps * 2))?;
        // No frame reordering keeps timestamps and the drain tail small.
        codec.SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &VARIANT::from(0u32))?;
        let output = media_type(plan, &MFVideoFormat_H264)?;
        output.SetUINT32(&MF_MT_AVG_BITRATE, plan.bitrate)?;
        output.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
        transform.SetOutputType(0, &output, 0)?;
        transform.SetInputType(0, &media_type(plan, &MFVideoFormat_NV12)?, 0)?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0)?;
        transform.ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0)?;
        let events = if asynchronous { Some(transform.cast()?) } else { None };
        Ok(Self { transform, events, input_ready: 0, output_ready: 0, drained: false, name })
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
    unsafe fn output(&mut self, packets: &SyncSender<Packet>) -> Result<u64> {
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
                        let bytes = std::slice::from_raw_parts(data, length as usize).to_vec();
                        buffer.Unlock()?;
                        let packet = Packet { bytes, time: sample.GetSampleTime()?, duration: sample.GetSampleDuration()?, key: sample.GetUINT32(&MFSampleExtension_CleanPoint).unwrap_or(0) };
                        match packets.try_send(packet) {
                            Ok(()) => count += 1,
                            Err(TrySendError::Full(_)) => return Err(failure("MP4 writer cannot keep up; encoded packet queue is full")),
                            Err(TrySendError::Disconnected(_)) => return Err(failure("MP4 writer failed")),
                        }
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
        let crop = texture(&device, plan.width, plan.height, DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_BIND_RENDER_TARGET.0 as u32, false)?;
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
        let item: GraphicsCaptureItem = interop.CreateForMonitor(monitor)?;
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let signal = closed.clone();
        let token = item.Closed(&::windows::Foundation::TypedEventHandler::new(move |_, _| { signal.store(true, std::sync::atomic::Ordering::Relaxed); Ok(()) }))?;
        let dxgi: IDXGIDevice = self.device.cast()?;
        let winrt: IDirect3DDevice = CreateDirect3D11DeviceFromDXGIDevice(&dxgi)?.cast()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(&winrt, DirectXPixelFormat::B8G8R8A8UIntNormalized, 2, item.Size()?)?;
        let session = pool.CreateCaptureSession(&item)?;
        session.SetIsCursorCaptureEnabled(plan.cursor)?;
        session.StartCapture()?;
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

struct Packet { bytes: Vec<u8>, time: i64, duration: i64, key: u32 }
struct PacketWriter {
    sender: Option<SyncSender<Packet>>,
    worker: Option<thread::JoinHandle<Result<()>>>,
}
impl PacketWriter {
    fn sender(&self) -> &SyncSender<Packet> { self.sender.as_ref().unwrap() }
    fn finish(mut self) -> Result<()> {
        self.sender.take();
        self.worker.take().unwrap().join().map_err(|_| failure("MP4 writer panicked"))?
    }
}
impl Drop for PacketWriter {
    fn drop(&mut self) { self.sender.take(); if let Some(worker) = self.worker.take() { let _ = worker.join(); } }
}
fn writer(plan: RecordingPlan, header: Vec<u8>, packets: mpsc::Receiver<Packet>, ready: SyncSender<std::result::Result<(),String>>) -> Result<()> {
    let _platform = MediaPlatform::start()?;
    let result = unsafe {
        (|| -> Result<()> {
            let path = temp_path(&plan.path);
            let output_type = media_type(&plan, &MFVideoFormat_H264)?;
            output_type.SetUINT32(&MF_MT_AVG_BITRATE, plan.bitrate)?;
            output_type.SetUINT32(&MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_High.0 as u32)?;
            if !header.is_empty() { output_type.SetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &header)?; }
            let stream = MFCreateFile(MF_ACCESSMODE_WRITE, MF_OPENMODE_FAIL_IF_EXIST, MF_FILEFLAGS_NONE, &HSTRING::from(path.as_os_str()))?;
            let sink = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), &stream, None)?;
            let index = sink.AddStream(&output_type)?;
            sink.SetInputMediaType(index, &output_type, None)?;
            sink.BeginWriting()?;
            let _ = ready.send(Ok(()));
            let write_result = (|| -> Result<()> {
                while let Ok(packet) = packets.recv() {
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
    if let Err(e) = &result { let _ = ready.try_send(Err(e.to_string())); }
    result
}

pub fn record(mut plan: RecordingPlan, control: &Arc<Mutex<Control>>, ready: &SyncSender<std::result::Result<(),String>>) -> Result<()> {
    let _platform = MediaPlatform::start()?;
    let displays = native_displays()?;
    let matches: Vec<_> = displays.iter().filter(|d| d.info.id == plan.display).collect();
    let display = if matches.len() == 1 { matches[0] } else if plan.display == "Display 1" && displays.len() == 1 { &displays[0] }
        else { return Err(failure("Display is missing or ambiguous; select a display again")); };
    plan.validate(&display.info).map_err(failure)?;
    std::fs::create_dir_all(plan.path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."))).map_err(|e| failure(e.to_string()))?;
    if plan.path.exists() { return Err(failure("Output file already exists; choose a unique filename")); }
    unsafe {
        let gpu = Gpu::new(&plan, &display.adapter).map_err(|e| failure(format!("D3D11 setup: {e}")))?;
        let desc = display.adapter.GetDesc1()?;
        let luid = ((desc.AdapterLuid.HighPart as u32 as u64) << 32) | desc.AdapterLuid.LowPart as u64;
        let mut encoder = Encoder::new(&plan, luid, &gpu.manager).map_err(|e| failure(format!("H.264 setup: {e}")))?;
        let capture = gpu.capture(&plan, display.output.GetDesc()?.Monitor).map_err(|e| failure(format!("WGC setup: {e}")))?;
        let (packet_tx, packet_rx) = mpsc::sync_channel((plan.fps*2) as usize);
        let (writer_tx, writer_rx) = mpsc::sync_channel(1);
        let writer_plan = plan.clone();
        let output_type = encoder.transform.GetOutputCurrentType(0)?;
        let mut header = vec![0u8; output_type.GetBlobSize(&MF_MT_MPEG_SEQUENCE_HEADER).unwrap_or(0) as usize];
        if !header.is_empty() { output_type.GetBlob(&MF_MT_MPEG_SEQUENCE_HEADER, &mut header, None)?; }
        let writer_thread = thread::spawn(move || writer(writer_plan, header, packet_rx, writer_tx));
        let packet_writer = PacketWriter { sender: Some(packet_tx), worker: Some(writer_thread) };
        writer_rx.recv_timeout(Duration::from_secs(10)).map_err(|e| failure(e.to_string()))?.map_err(failure)?;
        let first_deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if control.lock().unwrap_or_else(|e| e.into_inner()).stop { return Err(failure("Recording cancelled during startup")); }
            if gpu.update(&capture, &plan, &display.info)? > 0 { break; }
            if Instant::now() >= first_deadline { return Err(failure("Capture did not produce a frame")); }
            thread::sleep(Duration::from_millis(2));
        }
        {
            let mut state = control.lock().unwrap_or_else(|e| e.into_inner());
            state.stats = RecordingStats { encoder: encoder.name.clone(), adapter: text16(&desc.Description), width: plan.output_width, height: plan.output_height, fps: plan.fps, output_path: plan.path.to_string_lossy().into(), partial_path: temp_path(&plan.path).to_string_lossy().into(), ..Default::default() };
        }
        let mut clock = Timeline::new(); let mut next_tick = 0u64; let mut fresh = true;
        let _ = ready.send(Ok(()));
        let run_result = (|| -> Result<()> {
            loop {
                let (stop, paused) = { let c = control.lock().unwrap_or_else(|e| e.into_inner()); (c.stop,c.paused) };
                if stop { break; }
                let elapsed = clock.update(paused);
                let outputs = encoder.output(packet_writer.sender())?;
                let frames = gpu.update(&capture, &plan, &display.info)?;
                fresh |= frames > 0;
                {
                    let mut c = control.lock().unwrap_or_else(|e| e.into_inner());
                    c.stats.encoded_frames += outputs; c.stats.duration_ms = elapsed.as_millis() as u64;
                    c.stats.dropped_frames += frames.saturating_sub(1);
                }
                if paused { thread::sleep(Duration::from_millis(5)); continue; }
                let tick = (elapsed.as_nanos() * plan.fps as u128 / 1_000_000_000) as u64;
                if tick < next_tick { thread::sleep(Duration::from_millis(1)); continue; }
                if encoder.events.is_some() && encoder.input_ready == 0 { thread::sleep(Duration::from_millis(1)); continue; }
                if let Some(sample) = gpu.sample(&plan)? {
                    let time = (tick as u128 * 10_000_000 / plan.fps as u128) as i64;
                    let end = ((tick as u128+1) * 10_000_000 / plan.fps as u128) as i64;
                    sample.SetSampleTime(time)?; sample.SetSampleDuration(end-time)?;
                    if encoder.input(&sample)? {
                        let mut c = control.lock().unwrap_or_else(|e| e.into_inner());
                        c.stats.dropped_frames += tick.saturating_sub(next_tick);
                        if !fresh { c.stats.repeated_frames += 1; }
                        fresh = false;
                        next_tick = tick+1;
                    }
                }
            }
            Ok(())
        })();
        let stopped_at = Instant::now();
        drop(capture);
        let drain_result = (|| -> Result<()> {
            encoder.transform.ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0)?;
            encoder.transform.ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0)?;
            encoder.drained = false;
            loop {
                let count = encoder.output(packet_writer.sender())?;
                control.lock().unwrap_or_else(|e| e.into_inner()).stats.encoded_frames += count;
                if encoder.drained { break; }
                if stopped_at.elapsed() > Duration::from_secs(10) { return Err(failure("H.264 encoder drain timed out")); }
                thread::sleep(Duration::from_millis(1));
            }
            Ok(())
        })();
        let written = packet_writer.finish();
        run_result.map_err(|e| failure(format!("Recording loop: {e}")))?; drain_result.map_err(|e| failure(format!("Encoder drain: {e}")))?; written.map_err(|e| failure(format!("MP4 completion: {e}")))?;
        let partial = temp_path(&plan.path);
        // No REPLACE_EXISTING: a destination created during recording must survive.
        MoveFileExW(&HSTRING::from(partial.as_os_str()), &HSTRING::from(plan.path.as_os_str()), MOVEFILE_WRITE_THROUGH)
            .map_err(|e| failure(format!("Could not publish MP4; partial file retained at {}: {e}", partial.display())))?;
        control.lock().unwrap_or_else(|e| e.into_inner()).stats.stop_ms = Some(stopped_at.elapsed().as_millis() as u64);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn aspect_and_odd_padding() { assert_eq!(fitted_size(897,360,898,360), (897,360)); assert_eq!(fitted_size(1000,1000,1920,1080), (1080,1080)); }
}
