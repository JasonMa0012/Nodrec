@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0prototypes\imgui\build.ps1"
if errorlevel 1 (
    echo.
    echo Build or self-check failed. See output above.
    pause
    exit /b 1
)

start "" /D "%~dp0out\imgui-interaction" "%~dp0out\imgui-interaction\NodrecUiPrototype.exe"
if errorlevel 1 (
    echo Failed to launch NodrecUiPrototype.exe.
    pause
    exit /b 1
)
exit /b 0
