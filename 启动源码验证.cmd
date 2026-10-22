@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 exit /b 1

set "RHINE_PREVIEW_NODE=%~dp0.tools\source-preview-electron\electron.exe"
if not exist "%RHINE_PREVIEW_NODE%" goto missing
rem Use this project's Electron-provided Node, not a global or Codex-cache runtime.
set "ELECTRON_RUN_AS_NODE=1"
if not exist "%~dp0node_modules\music-metadata\package.json" goto missing
if not exist "%~dp0.tools\source-preview-interface\index.html" if not exist "%~dp0dist\index.html" goto missing

rem This launcher only uses existing files. It never runs npm ci or packaging.
if not exist "%~dp0.tools\source-launch\" mkdir "%~dp0.tools\source-launch"
if errorlevel 1 goto logfailed
set "RHINE_PREVIEW_LOG=%~dp0.tools\source-launch\source-preview-%RANDOM%-%RANDOM%.log"
rem GUI-subsystem Electron can detach its console. Capture both streams so a
rem double-clicked launch still reports the actual error instead of only code 1.
set "ELECTRON_ENABLE_STACK_DUMPING=1"
echo Rhine Music - SOURCE PREVIEW
echo Source: %~dp0
echo Opens the desktop application directly. No browser or final package is created.
echo Close the application window before restarting to load changed source files.
echo Launch log: %RHINE_PREVIEW_LOG%
echo.
"%RHINE_PREVIEW_NODE%" "%~dp0scripts\launch-source-preview.mjs" %* >"%RHINE_PREVIEW_LOG%" 2>&1
set "RHINE_PREVIEW_STATUS=%ERRORLEVEL%"
if "%RHINE_PREVIEW_STATUS%"=="0" exit /b 0
type "%RHINE_PREVIEW_LOG%"
echo.
echo Source preview exited with code %RHINE_PREVIEW_STATUS%.
echo Full details: %RHINE_PREVIEW_LOG%
pause
exit /b %RHINE_PREVIEW_STATUS%

:logfailed
echo Cannot create the project-local source launch log directory.
pause
exit /b 1

:missing
echo The project-local desktop runtime, dependencies or interface build is missing.
echo Nothing was installed or downloaded. Keep this file inside the complete checkout.
pause
exit /b 1
