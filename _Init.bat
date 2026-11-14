@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 exit /b 1
set "PATH=%USERPROFILE%\.cargo\bin;%ProgramFiles%\nodejs;%PATH%"

where.exe winget.exe >nul 2>nul
if errorlevel 1 (
    echo Install Microsoft App Installer ^(winget^) and run this script again.
    goto :failed
)

node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) === 24 ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
    call :install OpenJS.NodeJS.LTS --version 24.22.1
    if errorlevel 1 goto :failed
)
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) === 24 ? 0 : 1)"
if errorlevel 1 goto :failed

where.exe rustup.exe >nul 2>nul
if errorlevel 1 (
    call :install Rustlang.Rustup
    if errorlevel 1 goto :failed
)
rustup toolchain install stable-x86_64-pc-windows-msvc --profile minimal
if errorlevel 1 goto :failed

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
call :find_vs
if not defined NODREC_VS (
    call :install Microsoft.VisualStudio.2022.BuildTools --force --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if errorlevel 1 goto :failed
    call :find_vs
)
if not defined NODREC_VS goto :failed
call "%NODREC_VS%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
if errorlevel 1 goto :failed
where.exe cl.exe >nul 2>nul
if errorlevel 1 goto :failed
if not defined WindowsSdkDir (
    call :install Microsoft.VisualStudio.2022.BuildTools --force --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    if errorlevel 1 goto :failed
    call "%NODREC_VS%\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
    if errorlevel 1 goto :failed
)
if not defined WindowsSdkDir goto :failed

winget list --id Microsoft.EdgeWebView2Runtime --exact --accept-source-agreements --disable-interactivity >nul 2>nul
if errorlevel 1 (
    call :install Microsoft.EdgeWebView2Runtime
    if errorlevel 1 goto :failed
)

cd /d "%~dp0apps\desktop"
if errorlevel 1 goto :failed
call npm ci
if errorlevel 1 goto :failed
cargo +stable-x86_64-pc-windows-msvc fetch --locked --manifest-path src-tauri/Cargo.toml
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed
node scripts/stage-blueprints.mjs debug
if errorlevel 1 goto :failed
cargo +stable-x86_64-pc-windows-msvc build --locked --manifest-path src-tauri/Cargo.toml
if errorlevel 1 goto :failed
echo Initialization and development build completed. Run _Build_And_Run.bat to start Nodrec.
exit /b 0

:install
winget install --id %* --exact --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity
if errorlevel 1 exit /b 1
exit /b 0

:find_vs
set "NODREC_VS="
if exist "%VSWHERE%" for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "NODREC_VS=%%I"
exit /b 0

:failed
echo Initialization failed. Check the error above. If a restart is required, restart Windows and rerun _Init.bat.
pause
exit /b 1
