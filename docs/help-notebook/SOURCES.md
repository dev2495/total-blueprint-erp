# NotebookLM sources for the TPP ERP help bot

Upload these files from `docs/help-notebook/` (text, the bot's knowledge) and `docs/help-notebook-pdf/` (illustrated
guides with screenshots and flow charts, so the bot can match screenshots users send). Add the public guide as a
website source too: https://erp.totalpolyprint.com/guide

| # | File | What it covers |
|---|------|----------------|
| 1 | docs/help-notebook/00-start-here.md | Start here: how work flows, plant rules, modules, roles |
| 2 | docs/help-notebook/01-roles.md | Module overview + every screen, English and Hindi |
| 3 | docs/help-notebook/02-sales.md | Module overview + every screen, English and Hindi |
| 4 | docs/help-notebook/03-planner.md | Module overview + every screen, English and Hindi |
| 5 | docs/help-notebook/04-production.md | Module overview + every screen, English and Hindi |
| 6 | docs/help-notebook/05-dashboard.md | Module overview + every screen, English and Hindi |
| 7 | docs/help-notebook/06-logistics.md | Module overview + every screen, English and Hindi |
| 8 | docs/help-notebook/07-inventory.md | Module overview + every screen, English and Hindi |
| 9 | docs/help-notebook/08-gate.md | Module overview + every screen, English and Hindi |
| 10 | docs/help-notebook/09-master-data.md | Module overview + every screen, English and Hindi |
| 11 | docs/help-notebook/10-engineering.md | Module overview + every screen, English and Hindi |
| 12 | docs/help-notebook/11-factory.md | Module overview + every screen, English and Hindi |
| 13 | docs/help-notebook/12-maintenance.md | Module overview + every screen, English and Hindi |
| 14 | docs/help-notebook/13-procurement.md | Module overview + every screen, English and Hindi |
| 15 | docs/help-notebook/14-analytics.md | Module overview + every screen, English and Hindi |
| 16 | docs/help-notebook/15-system.md | Module overview + every screen, English and Hindi |
| 17 | docs/help-notebook/16-access.md | Module overview + every screen, English and Hindi |
| 18 | docs/help-notebook/17-profile.md | Module overview + every screen, English and Hindi |
| 19 | docs/help-notebook/18-help-center.md | Module overview + every screen, English and Hindi |
| 20 | docs/help-notebook/90-processes-and-decision-flows.md | Process charts and decision flows |
| 21 | docs/help-notebook/91-troubleshooting-error-index.md | Every on-screen error message and its fix |
| 22 | docs/help-notebook/92-known-gaps-what-is-missing.md | What is missing / not possible yet |
| 23 | docs/help-notebook/93-roles-daily-work.md | Roles and daily routines |
| 24 | docs/help-notebook/94-whats-new-release-notes.md | Release notes, newest first |
| 25 | docs/help-notebook-pdf/01-sales-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 26 | docs/help-notebook-pdf/02-planner-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 27 | docs/help-notebook-pdf/03-production-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 28 | docs/help-notebook-pdf/04-dashboard-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 29 | docs/help-notebook-pdf/05-logistics-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 30 | docs/help-notebook-pdf/06-inventory-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 31 | docs/help-notebook-pdf/07-gate-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 32 | docs/help-notebook-pdf/08-master-data-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 33 | docs/help-notebook-pdf/09-engineering-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 34 | docs/help-notebook-pdf/10-factory-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 35 | docs/help-notebook-pdf/11-maintenance-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 36 | docs/help-notebook-pdf/12-procurement-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 37 | docs/help-notebook-pdf/13-analytics-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 38 | docs/help-notebook-pdf/14-system-illustrated.pdf | Illustrated guide (screenshots, charts) |
| 39 | https://erp.totalpolyprint.com/guide (website) | The live guide; also https://erp.totalpolyprint.com/guide?lang=hi |

Total: 39 sources (NotebookLM allows 50 per notebook on the free plan).
Paste `BOT-INSTRUCTIONS.txt` into the notebook's Instructions (settings); do not upload it as a source.
Regenerate after any help change: `node frontend_v2/scripts/generate_help_notebook.mjs` and
`node frontend_v2/scripts/capture_help_pdfs.mjs`.
