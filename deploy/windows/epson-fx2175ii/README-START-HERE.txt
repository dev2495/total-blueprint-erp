TOTAL POLY PRINT - EPSON FX-2175II ONE-CLICK SETUP
==================================================

SUPPORTED WORKSTATION
- Windows 10 or Windows 11, 64-bit
- EPSON FX-2175II connected by USB or through an existing Windows printer queue
- 15 inch wide continuous tractor paper, 5.5 inch form length

FIRST SETUP OR UPDATE
1. Download TotalPolyPrint-Epson-Setup.exe from ERP > Logistics > Dispatch.
2. Double-click the downloaded EXE. If Windows SmartScreen appears, choose More info > Run anyway only after checking that the file came from erp.totalpolyprint.com.
3. The setup automatically selects the exact EPSON FX-2175II queue. It does not choose an older "Copy 1" queue when the exact queue is available.
4. Approve the Windows administrator prompt once. This creates or corrects the optional TPP 15x5.5 Windows paper form.
5. Wait for SETUP COMPLETE, then press Enter.

If the Epson queue is missing, setup offers the official Epson FX-2175II driver. The driver is downloaded directly from Epson only after the operator accepts Epson's license. Windows PnP Utility installs the signed package. The Epson driver is not copied or republished by Total Poly Print.

EVERYDAY PRINTING
1. Open ERP > Logistics > Dispatch.
2. Click Epson tractor print for the required dispatch slip.
3. The native background helper claims the downloaded .tppprint job and sends its validated RAW ESC/P bytes to EPSON FX-2175II.
4. Do not open the job in Word. Setup assigns .tppprint to Total Poly Print, and the helper also watches Downloads automatically.
5. Use A4 PDF only for a normal office printer, viewing, sharing, or saving a copy.

WHAT SETUP CHANGES
- Installs one native helper under %LOCALAPPDATA%\TotalPolyPrint\EpsonPrint.
- Starts it for the current Windows user and at future sign-ins.
- Assigns .tppprint files to the helper instead of Word.
- Creates/corrects the optional Windows paper form TPP 15x5.5. If Windows policy blocks that form, setup continues because each RAW Epson job already carries the exact 5.5-inch ESC/P form length.
- Preserves failed/interrupted jobs for review and never retries them automatically.
- Does not change ERP data, dispatch records, or dispatch-slip content.

IF A SLIP DOES NOT PRINT
1. Confirm EPSON FX-2175II is on, online, loaded with paper, and has no paused job.
2. Run TotalPolyPrint-Epson-Setup.exe again. Updates are safe and keep print history.
3. Check the latest ERROR in:
   %LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log
4. Failed or interrupted jobs are retained here and are not automatically reprinted:
   %LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed
5. From Command Prompt, run:
   TotalPolyPrint-Epson-Setup.exe --diagnose
   Give the diagnostic text and latest ERROR line to ERP support.

PRINT SAFETY
- Setup performs protocol, heartbeat, paper-form, and spooler checks without consuming a physical form.
- A job is archived only after Windows accepts its complete RAW spooler document.
- A job interrupted at an uncertain point is quarantined; an operator must decide whether it should be reprinted.
- The helper accepts only the approved TPPPRINT/1 header, exact ESC/P control prefix, form feed, maximum size, and .tppprint files from the current user's Downloads folder.

VERSION 3.0.1
Native Windows x64 helper; no PowerShell or VBS runtime dependency.
