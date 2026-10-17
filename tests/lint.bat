@echo off
pushd "%~dp0..\apps\desktop"
if errorlevel 1 exit /b 1
call npm run lint
set test_result=%errorlevel%
popd
echo.
echo Exit code: %test_result%
if not defined NODREC_TEST_NO_PAUSE pause
exit /b %test_result%
