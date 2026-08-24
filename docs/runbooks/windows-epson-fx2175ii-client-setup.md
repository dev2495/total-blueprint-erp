# EPSON FX-2175II one-click client setup — 15 × 5.5 inch slips

Use this guide on the Windows 10/11 64-bit computer connected to the EPSON FX-2175II. Setup is per Windows user. Daily operators only use **Epson tractor print** in ERP.

## What this fixes

- Replaces the PowerShell/VBS watcher that could be blocked at setup Step 8 with one native Windows executable.
- Assigns `.tppprint` to Total Poly Print and watches Downloads, so the raw ESC/P job is not a Word document.
- Automatically prefers the exact **EPSON FX-2175II** queue over an older **Copy 1** queue.
- Creates or corrects the **TPP 15x5.5** Windows paper form with one administrator approval.
- Validates every job's Total Poly Print header, printer/paper contract, ESC/P prefix, form feed, origin folder, and size before spooling.
- Sends 10-CPI Roman NLQ, unidirectional RAW ESC/P with a 33-line/5.5-inch form length; the browser never scales it.
- Quarantines jobs left from before setup and interrupted jobs instead of risking an automatic duplicate print.

Business quantities, weights, names, product details, and totals are unchanged by this printing-only release. **A4 PDF · normal printer** remains a separate output for viewing, sharing, records, and office printers.

## One-click setup or repair

1. Connect and switch on the EPSON FX-2175II. Load 15-inch continuous tractor paper.
2. Sign in to ERP and open **Logistics → Dispatch**.
3. Click **Epson setup · One click**. The browser downloads `TotalPolyPrint-Epson-Setup.exe`.
4. Double-click the downloaded EXE.
5. If SmartScreen appears, verify the file came from `erp.totalpolyprint.com`, then choose **More info → Run anyway**. This release is not Authenticode-signed until Total Poly Print supplies a Windows code-signing certificate.
6. Approve the administrator prompt once so setup can create/correct the **TPP 15x5.5** print-server form.
7. Wait up to 15 seconds for the verified helper heartbeat and the **SETUP COMPLETE** message. Press Enter.

The setup installs under `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint`, starts the native background agent immediately, and registers it for the current user's future sign-ins. It removes the old startup VBS entry. No PowerShell execution-policy bypass is used.

If the exact Epson queue is missing, setup explains the Epson license and requires the operator to type `I AGREE`. It then downloads **FX-2175II Printer Driver 1.0.0.0** directly from Epson over HTTPS and asks Windows PnP Utility to install the signed driver package. Total Poly Print does not republish Epson's driver. If Epson blocks the automatic download, setup opens the official Epson support page.

Setup deliberately does not print a physical test form. Old `.tppprint` files already in Downloads are moved to `Failed` for review so installing the fix cannot reprint an old dispatch slip.

## First physical acceptance test

Use one spare continuous form after setup succeeds.

1. Align the perforation at the printer's tear-off position.
2. In **ERP → Logistics → Dispatch**, choose the required ready units.
3. Click **Epson tractor · visible slip** or **Epson tractor · selected slip** exactly once.
4. Do not open the downloaded `.tppprint` file. The native agent claims it automatically.
5. Confirm:
   - one ERP click produced one physical slip;
   - the next form starts at the next perforation;
   - output uses the 15-inch width and one 5.5-inch form height;
   - text is dark, sharp, readable, and not clipped;
   - data/totals match **A4 PDF · normal printer** for the same selection.

If the first line is consistently high or low, use the printer's **Micro Adjust / Tear Off** buttons. Do not change browser zoom, CSS, or PDF scaling.

## Everyday use

1. Open **ERP → Logistics → Dispatch**.
2. Select the required ready units.
3. Click **Epson tractor print** once and wait for the slip.
4. Use **A4 PDF · normal printer** only for preview, sharing/archive, or an A4 laser/inkjet printer.

## Troubleshooting

### Nothing prints

1. Check printer power, cable, paper, error lights, and that the Epson queue is not paused.
2. Run `TotalPolyPrint-Epson-Setup.exe` again. It safely repairs the registration and updates the helper.
3. Do not repeatedly click ERP print while diagnosing.
4. From Command Prompt run `TotalPolyPrint-Epson-Setup.exe --diagnose`.
5. Give ERP support the diagnostic output and latest `ERROR` from:
   `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log`

### The old raw file opens in Word

1. Do not print it from Word; it is not a document.
2. Run the v3 setup again to refresh `.tppprint` ownership.
3. Download a fresh job from ERP. Pre-setup jobs are intentionally ignored/quarantined to prevent duplicates.

### A full 11-inch page feeds or the tear line is wrong

1. Run setup again so **TPP 15x5.5** is corrected to 15.00 × 5.50 inches (38.10 × 13.97 cm).
2. Confirm the printer uses the rear/continuous tractor and paper is aligned at the tear-off position.
3. Power-cycle the printer and run one fresh test.
4. Use Micro Adjust only for a small fixed offset; a half-page error is a form/tractor setting problem.

### Text is light or doubled

1. Confirm the latest helper log success ends with **normal-body 10-CPI NLQ unidirectional mode**.
2. Run the printer's built-in letter-quality self-test by holding **Load/Eject** while switching it on.
3. If the printer's own test is light, service/replace the ribbon and set the head-gap lever for the paper thickness.
4. If the self-test is dark but doubled, run Epson **Bi-D Adjustment**. ERP jobs still force unidirectional output.

### A job failed midway

The helper never retries an interrupted job automatically because the printer may already have produced part or all of it. Review:

`%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed`

Confirm the physical outcome, correct the fault, then generate one fresh ERP job only if needed.

## Support, retention, and uninstall

- Status heartbeat: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\agent-status.json`
- Helper log: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log`
- Printed-job archive: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Printed` (30 days)
- Failed/interrupted review: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed` (not auto-deleted)
- Uninstall: run `TotalPolyPrint-Epson-Setup.exe --uninstall` from Command Prompt.

Uninstall removes the current user's autostart and file association, but preserves logs/history and does not remove the Epson driver, printer queue, or ERP data.

Official references:

- [EPSON FX-2175II support and downloads](https://www.epson.co.in/Support/Printers/Dot-Matrix-Printers/FX-Series/Epson-FX-2175II/s/SPRT_C11CF38509)
- [EPSON FX-2175II product specifications](https://www.epson.co.in/9-Pin-Dot-Matrix-Printers/Epson-FX-2175II-Dot-Matrix-Printer/p/C11CF38509)
- [Microsoft PnPUtil command syntax](https://learn.microsoft.com/en-us/windows-hardware/drivers/devtest/pnputil-command-syntax)
- [Microsoft raw printer data guidance](https://learn.microsoft.com/en-us/windows/win32/printdocs/sending-data-directly-to-a-printer)
