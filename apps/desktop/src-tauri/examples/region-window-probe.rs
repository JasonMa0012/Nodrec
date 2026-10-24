//! Inspect the real region windows of the isolated desktop test process.
#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    use windows::{core::BOOL, Win32::{Foundation::{HWND, LPARAM, POINT}, Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion}, UI::WindowsAndMessaging::*}};
    struct Probe { pid: u32, frame: Option<HWND>, toolbar: Option<HWND> }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let probe = &mut *(data.0 as *mut Probe);
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == probe.pid {
            let mut text = [0u16; 128];
            let length = GetWindowTextW(hwnd, &mut text);
            match String::from_utf16_lossy(&text[..length as usize]).as_str() {
                "Nodrec Region frame" => probe.frame = Some(hwnd),
                "Nodrec Region toolbar" => probe.toolbar = Some(hwnd),
                _ => {},
            }
        }
        true.into()
    }
    let args: Vec<_> = std::env::args().collect();
    let mut probe = Probe { pid: args.get(1).ok_or("Missing PID")?.parse()?, frame: None, toolbar: None };
    let coordinates: Vec<i32> = args.iter().skip(2).map(|s| s.parse()).collect::<Result<_,_>>()?;
    if !coordinates.is_empty() && coordinates.len() != 6 { return Err("Expected desktop x/y and region x/y/width/height".into()); }
    unsafe {
        EnumWindows(Some(visit), LPARAM(&mut probe as *mut Probe as isize))?;
        if coordinates.is_empty() { return Ok(()); }
        let frame = probe.frame.ok_or("Missing native frame window")?;
        let toolbar = probe.toolbar.ok_or("Missing native toolbar window")?;
        for hwnd in [frame, toolbar] {
            let mut affinity = 0;
            GetWindowDisplayAffinity(hwnd, &mut affinity)?;
            assert_eq!(affinity, WDA_EXCLUDEFROMCAPTURE.0, "Native exclusion affinity");
        }
        let [dx,dy,x,y,w,h] = coordinates[..] else { unreachable!() };
        let region = CreateRectRgn(0,0,0,0);
        assert_ne!(GetWindowRgn(frame,region).0,0);
        assert!(!PtInRegion(region,x+w/2,y+h/2).as_bool(), "The region interior must be a native window hole");
        assert!(PtInRegion(region,x,y+h/4).as_bool(), "The border must remain an input surface");
        assert_ne!(GetAncestor(WindowFromPoint(POINT{x:dx+x+w/2,y:dy+y+h/2}),GA_ROOT),frame, "Native hit testing must reach the window underneath");
        let _ = DeleteObject(region.into());
    }
    println!("Native window hole, border hit surface, desktop hit-through, and both capture affinities verified");
    Ok(())
}
#[cfg(not(windows))]
fn main() { panic!("Windows required"); }
