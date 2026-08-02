$ErrorActionPreference = "SilentlyContinue"
$BaseDir = "$env:LOCALAPPDATA\TotalPolyPrint\EpsonPrint"
$PidPath = Join-Path $BaseDir "agent.pid"
$StartupPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Total Poly Print Epson Helper.vbs"

if (Test-Path -LiteralPath $PidPath) {
    $agentPid = Get-Content -LiteralPath $PidPath
    if ($agentPid) { Stop-Process -Id ([int]$agentPid) -Force }
}
Remove-Item -LiteralPath $StartupPath -Force
Remove-Item -LiteralPath $BaseDir -Recurse -Force
Write-Host "Total Poly Print Epson helper was removed."
