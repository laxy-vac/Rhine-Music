@echo off
chcp 65001 >nul
rem Compatibility entry: the current friends preview is a normal NSIS installer.
call "%~dp0打包品尝版.cmd" %*
exit /b %ERRORLEVEL%
