mod baseline;
mod current;
use std::{time::{Duration,Instant},path::PathBuf};
use windows::Win32::{Foundation::FILETIME,System::{Threading::{GetCurrentProcess,GetProcessTimes},ProcessStatus::{GetProcessMemoryInfo,PROCESS_MEMORY_COUNTERS},Com::{CoInitializeEx,CoUninitialize,COINIT_MULTITHREADED}}};
fn cpu() -> u64 { unsafe {let(mut creation,mut exit,mut kernel,mut user)=(FILETIME::default(),FILETIME::default(),FILETIME::default(),FILETIME::default());GetProcessTimes(GetCurrentProcess(),&mut creation,&mut exit,&mut kernel,&mut user).unwrap();((kernel.dwHighDateTime as u64)<<32|kernel.dwLowDateTime as u64)+((user.dwHighDateTime as u64)<<32|user.dwLowDateTime as u64)} }
macro_rules! plan {($m:ident,$path:expr)=>{{let display=$m::displays()?.remove(0);$m::RecordingPlan{display:display.id,full_display:false,x:100,y:100,width:897,height:360,output_width:0,output_height:0,fps:60,bitrate:20_000_000,software:false,cursor:true,path:$path}}}}
fn main()->Result<(),Box<dyn std::error::Error>>{
 unsafe{CoInitializeEx(None,COINIT_MULTITHREADED).ok()?;}
 let args:Vec<_>=std::env::args().collect();let mode=&args[1];let path=PathBuf::from(&args[2]);let duration=Duration::from_secs(4);let before=cpu();let wall=Instant::now();let setup;
 let stats=if mode=="baseline" {let plan=plan!(baseline,path.clone());let session=baseline::RecordingSession::start(plan)?;setup=wall.elapsed().as_secs_f64()*1000.;std::thread::sleep(duration);serde_json::to_value(session.stop()?)?}
 else {let plan=plan!(current,path.clone());let copy=path.with_file_name(format!("{}-copy.mp4",path.file_stem().unwrap().to_string_lossy()));let session=match mode.as_str(){"single"=>current::RecordingSession::start(plan)?,"shared"=>current::RecordingSession::start_outputs(plan,vec![path.clone(),copy])?,"dual"=>{let mut second=plan.clone();second.output_width=640;second.output_height=360;second.path=copy.clone();current::RecordingSession::start_graph(plan.clone(),vec![(plan,vec![path.clone()]),(second,vec![copy])])?},_=>return Err("Unknown mode".into())};setup=wall.elapsed().as_secs_f64()*1000.;std::thread::sleep(duration);serde_json::to_value(session.stop()?)?};
 let elapsed=wall.elapsed().as_secs_f64();let cpu_seconds=(cpu()-before)as f64/10_000_000.;let mut memory=PROCESS_MEMORY_COUNTERS::default();unsafe{GetProcessMemoryInfo(GetCurrentProcess(),&mut memory,std::mem::size_of::<PROCESS_MEMORY_COUNTERS>()as u32)?;CoUninitialize();}
 println!("{}",serde_json::json!({"mode":mode,"setupMs":setup,"wallSeconds":elapsed,"cpuSeconds":cpu_seconds,"cpuPercentOneCore":cpu_seconds/elapsed*100.,"peakWorkingSetMiB":memory.PeakWorkingSetSize as f64/1048576.,"stats":stats}));Ok(())
}
