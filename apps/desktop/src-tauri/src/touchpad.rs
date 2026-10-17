use std::{collections::HashMap, env, mem::transmute, ptr::null_mut, sync::{Mutex, OnceLock}};
use serde::Serialize;
use tauri::{Emitter, Manager, WebviewWindow};
use windows::{
    core::{s, w, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::LibraryLoader::{GetModuleHandleW, GetProcAddress},
        UI::{Input::{KeyboardAndMouse::SetFocus, Pointer::{GetPointerInfo, POINTER_INFO, POINTER_TOUCH_INFO}}, WindowsAndMessaging::{CallWindowProcW, DefWindowProcW, EnumChildWindows, GetClassNameW, GetWindowThreadProcessId, SetForegroundWindow, SetWindowLongPtrW, ShowWindow, GWLP_WNDPROC, PT_TOUCHPAD, SW_RESTORE, WM_NCDESTROY, WM_POINTERDOWN, WM_POINTERUP, WM_POINTERUPDATE, WNDPROC}},
    },
};

type GetTouchpadFrame = unsafe extern "system" fn(u32, *mut u32, *mut POINTER_TOUCH_INFO) -> BOOL;

struct Hook {
    original: WNDPROC,
    app: tauri::AppHandle,
    register: unsafe extern "system" fn(HWND, BOOL) -> BOOL,
    get_frame: GetTouchpadFrame,
    class: String,
    process_id: u32,
    thread_id: u32,
}

#[derive(Clone, Serialize)]
struct Contact {
    pointer_id: u32,
    flags: u32,
    device: usize,
    x: i32,
    y: i32,
    mouse_x: i32,
    mouse_y: i32,
    time: u32,
    pressure: u32,
    touch_mask: u32,
}

#[derive(Clone, Serialize)]
struct Frame {
    message: u32,
    pointer_id: u32,
    pointer_type: Option<u32>,
    pointer_info_error: Option<u32>,
    window_class: String,
    window_process_id: u32,
    window_thread_id: u32,
    frame_query_succeeded: bool,
    frame_query_error: Option<u32>,
    contact_count: u32,
    frame_read_succeeded: bool,
    frame_read_error: Option<u32>,
    contacts: Vec<Contact>,
}

static HOOKS: OnceLock<Mutex<HashMap<isize, Hook>>> = OnceLock::new();

unsafe extern "system" fn collect_child(child: HWND, result: LPARAM) -> BOOL {
    let mut name = [0u16; 32];
    let len = unsafe { GetClassNameW(child, &mut name) };
    let class = String::from_utf16_lossy(&name[..len.max(0) as usize]);
    unsafe { (*(result.0 as *mut Vec<(HWND, String)>)).push((child, class)); }
    BOOL(1)
}

unsafe extern "system" fn window_proc(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let key = hwnd.0 as isize;
    let hook = HOOKS.get().and_then(|hooks| hooks.lock().ok()?.get(&key).map(|hook| (hook.original, hook.app.clone(), hook.register, hook.get_frame, hook.class.clone(), hook.process_id, hook.thread_id)));
    let Some((original, app, register, get_frame, class, process_id, thread_id)) = hook else {
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    };

    if matches!(message, WM_POINTERDOWN | WM_POINTERUPDATE | WM_POINTERUP) {
        let pointer_id = (wparam.0 & 0xffff) as u32;
        let frame = unsafe { read_frame(get_frame, pointer_id, message, &class, process_id, thread_id) };
        let _ = app.emit_to("main", "precision-touchpad-pointer", frame);
    }

    if message == WM_NCDESTROY {
        let _ = unsafe { register(hwnd, BOOL(0)) };
        if let Some(hooks) = HOOKS.get() {
            if let Ok(mut hooks) = hooks.lock() {
                hooks.remove(&key);
            }
        }
        let previous = original.map_or(0, |proc| proc as usize as isize);
        unsafe { SetWindowLongPtrW(hwnd, GWLP_WNDPROC, previous) };
    }

    unsafe { CallWindowProcW(original, hwnd, message, wparam, lparam) }
}

unsafe fn read_frame(get_frame: GetTouchpadFrame, pointer_id: u32, message: u32, class: &str, process_id: u32, thread_id: u32) -> Frame {
    let mut pointer_info = POINTER_INFO::default();
    let pointer_info_succeeded = unsafe { GetPointerInfo(pointer_id, &mut pointer_info) }.is_ok();
    let pointer_info_error = (!pointer_info_succeeded).then(|| windows::Win32::Foundation::GetLastError().0);
    let pointer_type = pointer_info_succeeded.then_some(pointer_info.pointerType.0 as u32);
    let mut count = 0;
    let frame_query_succeeded = pointer_type == Some(PT_TOUCHPAD.0 as u32)
        && unsafe { get_frame(pointer_id, &mut count, null_mut()) }.as_bool();
    let frame_query_error = (pointer_type == Some(PT_TOUCHPAD.0 as u32) && !frame_query_succeeded)
        .then(|| windows::Win32::Foundation::GetLastError().0);
    let contact_count = count;
    let mut frame_read_succeeded = false;
    let mut frame_read_error = None;
    let mut contacts = Vec::new();
    if frame_query_succeeded && count > 0 && count <= 16 {
        let mut pointers = vec![POINTER_TOUCH_INFO::default(); count as usize];
        frame_read_succeeded = unsafe { get_frame(pointer_id, &mut count, pointers.as_mut_ptr()) }.as_bool();
        if !frame_read_succeeded {
            frame_read_error = Some(windows::Win32::Foundation::GetLastError().0);
        } else {
            pointers.truncate(count as usize);
            contacts = pointers.into_iter().map(|pointer| Contact {
                pointer_id: pointer.pointerInfo.pointerId,
                flags: pointer.pointerInfo.pointerFlags.0,
                device: pointer.pointerInfo.sourceDevice.0 as usize,
                x: pointer.pointerInfo.ptHimetricLocationRaw.x,
                y: pointer.pointerInfo.ptHimetricLocationRaw.y,
                mouse_x: pointer.pointerInfo.ptPixelLocation.x,
                mouse_y: pointer.pointerInfo.ptPixelLocation.y,
                time: pointer.pointerInfo.dwTime,
                pressure: pointer.pressure,
                touch_mask: pointer.touchMask,
            }).collect();
        }
    }
    Frame {
        message,
        pointer_id,
        pointer_type,
        pointer_info_error,
        window_class: class.to_string(),
        window_process_id: process_id,
        window_thread_id: thread_id,
        frame_query_succeeded,
        frame_query_error,
        contact_count,
        frame_read_succeeded,
        frame_read_error,
        contacts,
    }
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    unsafe {
        let user32 = GetModuleHandleW(w!("user32.dll")).map_err(|error| error.to_string())?;
        let register = GetProcAddress(user32, s!("RegisterTouchpadCapableWindow"))
            .ok_or_else(|| "Windows does not expose RegisterTouchpadCapableWindow".to_string())?;
        let register: unsafe extern "system" fn(HWND, BOOL) -> BOOL = transmute(register);
        let parent = window.hwnd().map_err(|error| error.to_string())?;
        let mut windows = vec![(parent, "Nodrec".to_string())];
        let _ = EnumChildWindows(Some(parent), Some(collect_child), LPARAM(&mut windows as *mut _ as isize));
        let focus = windows.iter().find(|(_, class)| class == "WRY_WEBVIEW").map(|(hwnd, _)| *hwnd).unwrap_or(parent);
        let get_frame = GetProcAddress(user32, s!("GetPointerFrameTouchpadInfo"))
            .ok_or_else(|| "Windows does not expose GetPointerFrameTouchpadInfo".to_string())?;
        let get_frame: GetTouchpadFrame = transmute(get_frame);
        let mut registered = Vec::new();
        for (hwnd, class) in windows {
            let mut process_id = 0;
            let thread_id = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
            if process_id != std::process::id() {
                eprintln!("Precision Touchpad skipped foreign HWND: {class}, process {process_id}, thread {thread_id}");
                continue;
            }
            if !register(hwnd, BOOL(1)).as_bool() {
                continue;
            }
            let original = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, window_proc as *const () as usize as isize);
            if original == 0 {
                let _ = register(hwnd, BOOL(0));
                continue;
            }
            let original: WNDPROC = Some(transmute(original));
            HOOKS.get_or_init(Default::default).lock().map_err(|error| error.to_string())?.insert(hwnd.0 as isize, Hook {
                original,
                app: window.app_handle().clone(),
                register,
                get_frame,
                class: class.clone(),
                process_id,
                thread_id,
            });
            registered.push(format!("{class} (process {process_id}, thread {thread_id})"));
        }
        if registered.is_empty() {
            return Err(format!("No Nodrec HWND accepted touchpad registration: {}", windows::Win32::Foundation::GetLastError().0));
        }
        if env::var_os("NODREC_TOUCHPAD_TEST").is_some() {
            let _ = ShowWindow(parent, SW_RESTORE);
            let _ = SetForegroundWindow(parent);
            let _ = SetFocus(Some(focus));
        }
        eprintln!("Precision Touchpad registered HWNDs: {}", registered.join(", "));
    }
    Ok(())
}
