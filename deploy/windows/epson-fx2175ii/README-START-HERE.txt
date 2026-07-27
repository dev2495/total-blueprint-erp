TOTAL POLY PRINT - EPSON FX-2175II HELPER
=========================================

BEFORE SETUP
1. The EPSON FX-2175II must already be visible in Windows Settings > Printers & scanners.
2. Load the 15 inch wide continuous paper and align the tear line at the printer's tear-off position.
3. Ask the Windows administrator to create/select the 15 x 5.5 inch paper form as explained below.

INSTALL OR UPDATE
1. Right-click the downloaded ZIP and choose Extract All.
2. Open the extracted folder.
3. Double-click Install-TppEpsonPrintHelper.bat.
4. If Windows asks, choose Run anyway.
5. If a printer list appears, type the number beside EPSON FX-2175II and press Enter.
6. Wait for the green SETUP COMPLETE message.
7. Confirm it says: Print profile: 10 CPI / NLQ / unidirectional.
8. Press any key.

EVERYDAY PRINTING
1. Open ERP > Logistics > Dispatch.
2. Click the green Print on Epson button.
3. Do not open or print the downloaded .tppprint file. The helper handles it automatically.
4. Use Open PDF only for viewing, sharing, or saving a copy.

WINDOWS PRINTER PAPER SETTINGS (ADMIN, ONLY ONCE)
1. Open Control Panel > Devices and Printers.
2. Click any printer once, then click Print server properties at the top.
3. Open Forms, tick Create a new form, and name it TPP 15x5.5.
4. Set Width = 15.00 inches and Height = 5.50 inches. Keep margins at 0. Save Form.
5. Right-click EPSON FX-2175II > Printing preferences > Advanced.
6. Set Paper Size = TPP 15x5.5, Tractor/Continuous paper, Portrait, 100%/Actual size.
7. Turn OFF Fit to page, Shrink, Scale to fit, Multiple pages per sheet, and High speed/draft mode.
8. Set Tear Off/Auto Tear Off ON if available. ERP RAW jobs explicitly select NLQ and unidirectional mode themselves.

IF IT DOES NOT PRINT
1. Check that EPSON FX-2175II is on, online, has paper, and has no paused jobs.
2. Re-run Install-TppEpsonPrintHelper.bat and select the Epson printer again.
3. Check this log file:
   %LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log
4. Failed jobs are kept safely here and are NOT reprinted automatically:
   %LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed
5. Give the last ERROR line in helper.log to ERP support.

IF TEXT IS LIGHT OR GHOSTED
1. Confirm the latest helper success line says: using 10-CPI NLQ unidirectional mode.
2. If not, run this version 2 installer again.
3. Run the printer's own letter-quality self-test by holding Load/Eject while switching it on.
4. If that self-test is also light, service/replace the ribbon and set the head-gap lever for the paper thickness.

IMPORTANT
- Never send .tppprint files to another person or open them in an editor.
- A job interrupted halfway is not retried automatically, preventing duplicate slips.
- PDF printing is a fallback only and must use Actual size with TPP 15x5.5.
