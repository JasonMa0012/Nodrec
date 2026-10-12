@echo off
setlocal
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where.exe node.exe >nul 2>nul
if errorlevel 1 (
    echo Node.js is required to run Nodrec.
    pause
    exit /b 1
)
where.exe cargo.exe >nul 2>nul
if errorlevel 1 (
    echo Rust is required by Tauri. Install Rustup, reopen this window, and run this file again.
    pause
    exit /b 1
)
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -latest -products * -property installationPath`) do if exist "%%I\Common7\Tools\VsDevCmd.bat" call "%%I\Common7\Tools\VsDevCmd.bat" -arch=x64 -host_arch=x64 >nul
where.exe link.exe >nul 2>nul
if errorlevel 1 (
    echo Visual Studio C++ Build Tools are required to compile the Windows desktop app.
    pause
    exit /b 1
)

pushd "%~dp0apps\desktop"
if errorlevel 1 exit /b 1
if not exist "node_modules" (
    call npm ci
    if errorlevel 1 (
        popd
        echo Frontend dependency installation failed.
        pause
        exit /b 1
    )
)

call npm run tauri:dev
set "NODREC_EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %NODREC_EXIT_CODE%
