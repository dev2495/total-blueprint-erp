param(
    [string]$ConfigPath = "$env:LOCALAPPDATA\TotalPolyPrint\EpsonPrint\config.json"
)

$ErrorActionPreference = "Stop"
$BaseDir = Split-Path -Parent $ConfigPath
$ProcessingDir = Join-Path $BaseDir "Processing"
$ArchiveDir = Join-Path $BaseDir "Printed"
$FailedDir = Join-Path $BaseDir "Failed"
$LogDir = Join-Path $BaseDir "Logs"
$LogPath = Join-Path $LogDir "helper.log"
$PidPath = Join-Path $BaseDir "agent.pid"
$ExpectedHeader = "TPPPRINT/1`nprinter=EPSON-FX-2175II`npaper=15x5.5`nlanguage=ESC/P"

foreach ($path in @($BaseDir, $ProcessingDir, $ArchiveDir, $FailedDir, $LogDir)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
}

function Write-HelperLog {
    param([string]$Message, [string]$Level = "INFO")
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 2MB) {
        Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force
    }
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Get-DownloadsFolder {
    $registryPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders"
    $downloadsId = "{374DE290-123F-4565-9164-39C4925E467B}"
    try {
        $key = Get-Item -LiteralPath $registryPath
        $configured = $key.GetValue(
            $downloadsId,
            $null,
            [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
        )
        if ($configured) {
            return [Environment]::ExpandEnvironmentVariables([string]$configured)
        }
    } catch {
        Write-HelperLog "Could not read the Windows Downloads-folder setting; using the standard folder."
    }
    return (Join-Path $env:USERPROFILE "Downloads")
}

if (-not ("TppRawPrinter" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class TppRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOC_INFO_1
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool OpenPrinter(string printerName, out IntPtr printerHandle, IntPtr defaults);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern int StartDocPrinter(IntPtr printerHandle, int level, ref DOC_INFO_1 docInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr printerHandle);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr printerHandle, byte[] bytes, int count, out int written);

    private static void ThrowLastError(string operation)
    {
        throw new Win32Exception(Marshal.GetLastWin32Error(), operation + " failed");
    }

    public static void Send(string printerName, byte[] bytes, string documentName)
    {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) ThrowLastError("OpenPrinter");
        bool documentStarted = false;
        bool pageStarted = false;
        try
        {
            DOC_INFO_1 info = new DOC_INFO_1();
            info.pDocName = documentName;
            info.pDataType = "RAW";
            info.pOutputFile = null;
            if (StartDocPrinter(handle, 1, ref info) == 0) ThrowLastError("StartDocPrinter");
            documentStarted = true;
            if (!StartPagePrinter(handle)) ThrowLastError("StartPagePrinter");
            pageStarted = true;
            int written;
            if (!WritePrinter(handle, bytes, bytes.Length, out written)) ThrowLastError("WritePrinter");
            if (written != bytes.Length) throw new InvalidOperationException("Windows accepted only part of the print job.");
        }
        finally
        {
            if (pageStarted) EndPagePrinter(handle);
            if (documentStarted) EndDocPrinter(handle);
            ClosePrinter(handle);
        }
    }
}
"@
}

function Read-TppPrintJob {
    param([string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 64 -or $bytes.Length -gt 2MB) {
        throw "Print job size is invalid."
    }

    $separator = -1
    for ($index = 0; $index -lt ($bytes.Length - 1); $index++) {
        if ($bytes[$index] -eq 10 -and $bytes[$index + 1] -eq 10) {
            $separator = $index
            break
        }
    }
    if ($separator -lt 0) { throw "Print job header is missing." }

    $header = [Text.Encoding]::ASCII.GetString($bytes, 0, $separator)
    if ($header -ne $ExpectedHeader) { throw "Print job header is not approved for this printer." }

    $payloadStart = $separator + 2
    $payload = New-Object byte[] ($bytes.Length - $payloadStart)
    [Array]::Copy($bytes, $payloadStart, $payload, 0, $payload.Length)
    # The backend owns every hardware mode used by this RAW job. ESC x 1
    # selects NLQ and ESC U 1 selects unidirectional printing. ESC F and ESC H
    # then cancel the legacy global emphasis/double-strike modes so ordinary
    # rows receive one crisp NLQ impression instead of blurred over-strikes.
    $requiredPrefix = [byte[]](27, 64, 18, 27, 80, 27, 50, 27, 67, 33, 27, 79, 27, 69, 27, 71, 27, 120, 1, 27, 107, 0, 27, 85, 1, 27, 70, 27, 72)
    if ($payload.Length -le $requiredPrefix.Length) { throw "Print payload is empty." }
    for ($index = 0; $index -lt $requiredPrefix.Length; $index++) {
        if ($payload[$index] -ne $requiredPrefix[$index]) {
            throw "Print controls do not match the approved 15 x 5.5 inch layout."
        }
    }
    if (-not ($payload -contains 12)) { throw "Print payload has no form-feed command." }
    return ,$payload
}

$mutex = New-Object Threading.Mutex($false, "Local\TotalPolyPrintEpsonHelper")
if (-not $mutex.WaitOne(0, $false)) { exit 0 }

try {
    Set-Content -LiteralPath $PidPath -Value $PID -Encoding ASCII
    $downloadsDir = Get-DownloadsFolder
    New-Item -ItemType Directory -Path $downloadsDir -Force | Out-Null

    # A job left in Processing may already have reached the printer. Never
    # retry it automatically because that could create a duplicate slip.
    Get-ChildItem -LiteralPath $ProcessingDir -Filter "*.tppprint" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $destination = Join-Path $FailedDir ("restart-review-" + $_.Name)
        Move-Item -LiteralPath $_.FullName -Destination $destination -Force
        Write-HelperLog "Moved an interrupted job to Failed for manual review: $($_.Name)" "WARN"
    }

    Get-ChildItem -LiteralPath $ArchiveDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Write-HelperLog "Helper started. Watching '$downloadsDir'."
    while ($true) {
        try {
            if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Configuration is missing. Run the installer again." }
            $config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not $config.printerName) { throw "Printer name is missing from configuration." }
            Get-Printer -Name ([string]$config.printerName) -ErrorAction Stop | Out-Null

            $jobs = Get-ChildItem -LiteralPath $downloadsDir -Filter "*.tppprint" -File -ErrorAction SilentlyContinue |
                Where-Object { $_.LastWriteTime -lt (Get-Date).AddSeconds(-2) } |
                Sort-Object CreationTime

            foreach ($job in $jobs) {
                $claimedName = "{0}-{1}-{2}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), ([Guid]::NewGuid().ToString("N").Substring(0, 8)), $job.Name
                $claimedPath = Join-Path $ProcessingDir $claimedName
                try {
                    Move-Item -LiteralPath $job.FullName -Destination $claimedPath -ErrorAction Stop
                    $payload = Read-TppPrintJob -Path $claimedPath
                    [TppRawPrinter]::Send([string]$config.printerName, $payload, $job.BaseName)
                    Move-Item -LiteralPath $claimedPath -Destination (Join-Path $ArchiveDir $claimedName) -Force
                    Write-HelperLog "Printed '$($job.Name)' on '$($config.printerName)' using normal-body 10-CPI NLQ unidirectional mode."
                } catch {
                    if (Test-Path -LiteralPath $claimedPath) {
                        Move-Item -LiteralPath $claimedPath -Destination (Join-Path $FailedDir ("failed-" + $claimedName)) -Force
                    }
                    Write-HelperLog "Failed '$($job.Name)': $($_.Exception.Message)" "ERROR"
                }
            }
        } catch {
            Write-HelperLog $_.Exception.Message "ERROR"
            Start-Sleep -Seconds 15
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
