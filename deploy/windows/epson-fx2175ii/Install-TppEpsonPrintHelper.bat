@echo off
title Total Poly Print - Epson Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-TppEpsonPrintHelper.ps1"
if errorlevel 1 (
  echo.
  echo SETUP DID NOT FINISH. Read the red message above or call your ERP support person.
) else (
  echo Setup finished successfully.
)
echo.
pause
