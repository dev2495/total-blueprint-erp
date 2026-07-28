# EPSON FX-2175II client setup — 15 × 5.5 inch continuous slips

Use this guide once on the Windows computer connected to the EPSON FX-2175II. The daily operator will then only click **Epson tractor print** in the ERP.

## What this fixes

- The ERP sends native Epson ESC/P text at 10 characters per inch instead of asking a PDF viewer to shrink a wide page.
- Every RAW job explicitly selects normal-body Roman NLQ and unidirectional printing. It cancels global emphasis/double-strike after reset, then emphasizes only short headings and totals.
- Every physical form is fixed to 33 lines at 6 lines per inch: exactly 5.5 inches high.
- The separate PDF is a fill-only, 12 pt Courier A4-landscape document for a normal laser/inkjet office printer.
- The downloaded job is validated before Windows sends it to the selected Epson queue.
- **A4 PDF · normal printer** remains available for viewing, sharing, records, and office printing. It must not be sent to the Epson tractor-print workflow.

Business quantities, weights, product details, and totals are unchanged. The presentation now explicitly says **ONE SO**, uses the real SO item number, and shows balance only for items physically present on that slip.

## Part A — Windows administrator setup (once)

### 1. Check the printer and driver

1. Switch on the EPSON FX-2175II and load the 15-inch continuous paper on the tractor.
2. On Windows, click **Start → Settings → Devices (or Bluetooth & devices) → Printers & scanners**.
3. Confirm that **EPSON FX-2175II** appears. Do not continue with **Generic / Text Only**, **Microsoft Print to PDF**, or a similarly named substitute.
4. Open the Epson queue and print its Windows test page. Fix cable, port, offline, or paused-queue problems before continuing.

### 2. Create the correct 15 × 5.5 inch form

1. Open **Control Panel → Devices and Printers**.
2. Click any printer once. Click **Print server properties** in the top toolbar.
3. Open the **Forms** tab and tick **Create a new form**.
4. Enter form name **TPP 15x5.5**.
5. Set **Width = 15.00 inches** and **Height = 5.50 inches**. Set all margins to **0**.
6. Click **Save Form**.

If Windows only shows centimetres, enter **38.10 cm × 13.97 cm**.

### 3. Make that form the Epson default

1. In **Devices and Printers**, right-click **EPSON FX-2175II → Printing preferences**.
2. In **Paper/Quality** or **Advanced**, choose:
   - Paper size: **TPP 15x5.5**
   - Paper source: **Tractor / Continuous / Rear Push Tractor** (whichever matches the loaded tractor)
   - Orientation: **Portrait**
   - Scale: **100% / Actual size**
   - Quality: **Letter Quality / NLQ**
3. Turn **off**:
   - Fit to page / Scale to fit / Shrink oversized pages
   - Multiple pages per sheet
   - Draft / High-speed draft / Economy
4. Turn **Auto Tear Off / Tear Off** on if the driver offers it.
5. Click **Apply → OK**.

The Epson manual supports user-defined continuous forms and a 5.5-inch page length. The printer supports continuous paper 4–16 inches wide and 4–22 inches long.

### 4. Install or update the ERP print helper

1. Sign in to the ERP and open **Logistics → Dispatch**.
2. Click **Windows helper - Updated** and wait for `tpp-epson-print-helper.zip` to download.
3. Open **Downloads**. Right-click the ZIP and choose **Extract All → Extract**. Do not run it from inside the ZIP.
4. Open the extracted folder and double-click **Install-TppEpsonPrintHelper.bat**.
5. If Windows SmartScreen appears, click **More info → Run anyway**.
6. If a list appears, type the number beside **EPSON FX-2175II** and press **Enter**.
7. Wait for the green **SETUP COMPLETE** message. Confirm it says **Print profile: normal-body 10 CPI / NLQ / unidirectional**, then press any key.

The helper installs only for the signed-in Windows user and starts automatically at sign-in. It does not require a permanently open black window.

The installer detects the Windows printer queues and stores the selected **EPSON FX-2175II** queue. After that, every **Epson tractor print** click goes to that printer automatically. A web browser cannot silently inspect or choose local Windows printers; the separate A4 PDF therefore uses the normal Windows print dialog.

## Part B — first physical acceptance test

Use one spare continuous form.

1. Align the paper so the tear/perforation line is at the printer's tear-off position.
2. In ERP **Logistics → Dispatch**, choose a real order with ready units.
3. Click the green **Epson tractor · visible slip** or **Epson tractor · selected slip** button.
4. Wait for the printer. Do not open the downloaded `.tppprint` file.
5. Confirm all five checks:
   - One ERP click produced one physical slip.
   - The next form starts at the next perforation.
   - The print uses the full 15-inch width and only one 5.5-inch half-sheet height.
   - Text is dark, sharp, and readable; descriptions, weights, and totals are not clipped or ghosted.
   - The data and totals match **A4 PDF · normal printer** for the same selection.

If the first line is consistently too high or low, use the printer's **Micro Adjust / Tear Off** buttons to move the paper. Do not change ERP CSS, browser zoom, or PDF scaling.

## Part C — everyday operator steps

1. Open **ERP → Logistics → Dispatch**.
2. Select the required ready units.
3. Click the green **Epson tractor print** button.
4. Wait for the slip and tear it at the perforation.
5. Click **A4 PDF · normal printer** only for a screen preview, email/archive copy, or a normal laser/inkjet printer.

## Simple troubleshooting

### Nothing prints

1. Check printer power, cable, paper, and error lights.
2. Open the Epson print queue. Remove a paused state and clear any visibly failed old job.
3. Run `Install-TppEpsonPrintHelper.bat` again and select the Epson queue.
4. Click **Epson tractor print** once. Do not click repeatedly.
5. Send the last `ERROR` line from this file to ERP support:
   `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log`

### A full 11-inch page feeds or the tear line is wrong

1. Recheck that the Windows form is **15.00 × 5.50 inches**, not Letter, A4, 11 inches, or 12 inches.
2. Recheck the Epson default paper source and form.
3. Power the printer off and on after saving the driver setting, then run one test.
4. Use Micro Adjust only for a small fixed offset. A half-page error means the Windows/driver form is wrong.

### Text is still light

1. Open the helper log and confirm the latest success line ends with **using normal-body 10-CPI NLQ unidirectional mode**.
2. Reinstall **Windows helper v2.1** if that wording is missing, then print once again. The previously installed v2 helper can print the new compatible job, so an immediate reinstall is not required solely for this ERP release.
3. Run the printer's built-in letter-quality self-test: turn the printer off, hold **Load/Eject**, and turn it on. Stop it after one readable section.
4. If the printer's own letter-quality self-test is also light, replace/re-ink the ribbon and set the print-head gap lever for the actual paper thickness.
5. If the self-test is dark but letters are horizontally doubled, run Epson **Bi-D Adjustment** from Printer Properties, although ERP jobs now force unidirectional output to avoid this dependency.

The Windows Quality preference is not the authority for ERP RAW jobs. The ERP job now sends the NLQ, font, pitch, direction, line-spacing, and form-length commands itself.

### A job failed midway

The helper does not retry an interrupted job automatically because that could create a duplicate dispatch document. Failed/interrupted jobs are retained in:

`%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed`

Confirm whether a partial slip came out, correct the physical issue, and click **Epson tractor print** exactly once again if needed.

## A4 PDF for a normal printer

The PDF button is intentionally a different printer path:

1. Click **A4 PDF · normal printer**.
2. In Adobe Acrobat Reader choose an A4-capable laser/inkjet printer.
3. Choose **A4**, **Landscape**, and **Actual size / 100%**.
4. Do not print this A4 document through the Epson FX-2175II. If Epson RAW printing is unavailable, repair/restart the helper instead of substituting the A4 path.

## Support and rollback

- Helper log: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Logs\helper.log`
- Printed-job archive (30 days): `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Printed`
- Failed-job quarantine: `%LOCALAPPDATA%\TotalPolyPrint\EpsonPrint\Failed`
- To remove the helper, run `Uninstall-TppEpsonPrintHelper.bat` from the extracted setup folder.
- Removing the helper does not remove the Epson driver or change ERP data.

Official references:

- [EPSON FX-2175II product specifications](https://www.epson.co.in/9-Pin-Dot-Matrix-Printers/Epson-FX-2175II-Dot-Matrix-Printer/p/C11CF38509)
- [EPSON FX-2175II user guide](https://support2.epson.net/manuals/english/sidm/fx_2175ii/pdf/fx-2175ii_2175iin_ug_en.pdf)
- [Microsoft raw printer data guidance](https://learn.microsoft.com/en-us/windows/win32/printdocs/sending-data-directly-to-a-printer)
- [Adobe custom paper sizes](https://helpx.adobe.com/ca/acrobat/desktop/print-documents/set-up-and-print-pdfs/custom-sizes.html)
- [Adobe Actual size and page scaling](https://helpx.adobe.com/acrobat/kb/scale-or-resize-printed-pages.html)
