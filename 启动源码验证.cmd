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
echo Rhine Music - SOURCE PREVIEW
echo Source: %~dp0
echo Opens the desktop application directly. No browser or final package is created.
echo Close the application window before restarting to load changed source files.
echo.
"%RHINE_PREVIEW_NODE%" "%~dp0scripts\launch-source-preview.mjs" %*
set "RHINE_PREVIEW_STATUS=%ERRORLEVEL%"
if "%RHINE_PREVIEW_STATUS%"=="0" exit /b 0
echo Source preview exited with code %RHINE_PREVIEW_STATUS%.
pause
exit /b %RHINE_PREVIEW_STATUS%

:missing
echo The project-local desktop runtime, dependencies or interface build is missing.
echo Nothing was installed or downloaded. Keep this file inside the complete checkout.
pause
exit /b 1
