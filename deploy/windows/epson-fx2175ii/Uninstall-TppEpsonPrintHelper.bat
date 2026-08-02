@echo off
title Total Poly Print - Remove Epson Helper
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Uninstall-TppEpsonPrintHelper.ps1"
echo.
pause
