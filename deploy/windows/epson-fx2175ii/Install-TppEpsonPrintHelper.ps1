$ErrorActionPreference = "Stop"
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BaseDir = "$env:LOCALAPPDATA\TotalPolyPrint\EpsonPrint"
$AgentPath = Join-Path $BaseDir "TppEpsonPrintAgent.ps1"
$ConfigPath = Join-Path $BaseDir "config.json"
$PidPath = Join-Path $BaseDir "agent.pid"
$StartupDir = [Environment]::GetFolderPath("Startup")
$StartupPath = Join-Path $StartupDir "Total Poly Print Epson Helper.vbs"

Write-Host ""
Write-Host "TOTAL POLY PRINT - EPSON FX-2175II SETUP" -ForegroundColor Cyan
Write-Host "This setup does not change any ERP text or data."
Write-Host ""

if (-not (Get-Command Get-Printer -ErrorAction SilentlyContinue)) {
    throw "Windows printer tools are unavailable. Use Windows 10/11 and install the Epson driver first."
}

$allPrinters = @(Get-Printer | Sort-Object Name)
$epsonPrinters = @($allPrinters | Where-Object { $_.Name -match "EPSON.*FX[- ]?2175" })
if ($epsonPrinters.Count -eq 1) {
    $selectedPrinter = $epsonPrinters[0]
    Write-Host "Found printer: $($selectedPrinter.Name)" -ForegroundColor Green
} else {
    $choices = if ($epsonPrinters.Count -gt 1) { $epsonPrinters } else { $allPrinters }
    if ($choices.Count -eq 0) { throw "No Windows printer is installed. Install EPSON FX-2175II first." }
    Write-Host "Choose the EPSON FX-2175II printer number:" -ForegroundColor Yellow
    for ($index = 0; $index -lt $choices.Count; $index++) {
        Write-Host ("  {0}. {1}" -f ($index + 1), $choices[$index].Name)
    }
    do {
        $answer = Read-Host "Type the number and press Enter"
        $number = 0
        $valid = [int]::TryParse($answer, [ref]$number) -and $number -ge 1 -and $number -le $choices.Count
    } until ($valid)
    $selectedPrinter = $choices[$number - 1]
}

if ($selectedPrinter.Name -notmatch "EPSON.*FX[- ]?2175") {
    throw "The selected queue is not an EPSON FX-2175/2175II. Install/select the correct Epson driver and run setup again."
}

New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
foreach ($folder in @("Processing", "Printed", "Failed", "Logs")) {
    New-Item -ItemType Directory -Path (Join-Path $BaseDir $folder) -Force | Out-Null
}

if (Test-Path -LiteralPath $PidPath) {
    $oldPid = Get-Content -LiteralPath $PidPath -ErrorAction SilentlyContinue
    if ($oldPid) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
}

Copy-Item -LiteralPath (Join-Path $SourceDir "TppEpsonPrintAgent.ps1") -Destination $AgentPath -Force
Unblock-File -LiteralPath $AgentPath -ErrorAction SilentlyContinue
@{
    version = 2
    printerName = $selectedPrinter.Name
    installedAt = (Get-Date).ToString("o")
} | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

$vbs = @"
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ""$AgentPath""", 0, False
"@
Set-Content -LiteralPath $StartupPath -Value $vbs -Encoding ASCII
Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$AgentPath`""
)
Start-Sleep -Seconds 2
if (-not (Test-Path -LiteralPath $PidPath)) {
    throw "The helper could not start. Check Windows Security, then run setup again."
}

Write-Host ""
Write-Host "SETUP COMPLETE" -ForegroundColor Green
Write-Host "Printer: $($selectedPrinter.Name)"
Write-Host "Print profile: normal-body 10 CPI / NLQ / unidirectional"
Write-Host "The helper will start automatically whenever this Windows user signs in."
Write-Host "Return to the ERP and click 'Epson tractor print'."
Write-Host ""
