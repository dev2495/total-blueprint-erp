# Floor pages · 25 Oct 2026

Packing Yard, Dispatch Bay and the WC terminal rebuilt on the samples approved on 25 Oct, with the
owner's changes. Parent release: `95c5564e495e`. No migration, no environment change.

## Owner's rules applied

- **Packing items are ticks only.** No quantity is asked anywhere; a tick is one use on that unit and the
  evening count gives the consumption. Pouch gonny release now has the same tick list as rolls.
  Inner pouches and the gonny are already booked from each unit, so they are not ticked.
- **Vehicle number is optional.** Slips are created, printed and dispatched with or without it.
  The transporter stays required (printed as TRANSPORT NAME), with one-tap choices.
- **One slip per order line**, never mixed. A tray can hold lines from several orders; a line whose
  units sit at two plants gets two slips. Every slip of a tray is created together or none is.
- **WC terminal: only rolls and granule grade codes are entered.** Every other step material shows as
  "Auto · step mapping" and is sent at its planned quantity, exactly as before when nobody edited it
  (the machine's step close still receives it). One granule can be split over several grade codes.

## Packing Yard

- Order cards with the job name first and their ready lines inside (size in mm and inches, layers,
  inner pouch plan, pouches, net, machine, ready since, location). Tabs: Queue · In progress · History.
- Tick lines across orders, **Pack selected** opens one window with a tab per line: product plate,
  1 machine figures (with "Figures checked"), 2 how the pouches arrive (the order's choice), 3 build
  gonnies (pack, put on the scale, enter gross: sealed in the same step, or add open and weigh in the
  list), 4 packing items (ticks), 5 release. "Release all N lines" when every tab is ready.
- Released lines leave the queue and show in **History** (Today / 7 days / All): who, when, every
  gonny with its weights, the items ticked, the slip it is on.
- Kept: packing check (in Details), held-check notice, ready slip, audit, evening count, trace links.
- KPIs: lines ready, weight still to pack (pieces left × net per pouch), gonnies packed today, open /
  sealed, released today, variance alerts.

## Dispatch Bay

- Ready board customer → order → line, with ordered / dispatched / on this load / remaining per line,
  what is still in packing, and the per-unit manifest (packing slip on the Epson or A4 PDF).
- Loading tray: transport (vehicle optional), lines loaded per order with the delivery location,
  "N lines → N slips", Create → Print → Mark dispatched.
- The slips of the load show the exact text the Epson prints (the existing print endpoint, unchanged),
  with print, A4 PDF, QR sticker and copy.
- History: status tabs (drafts, awaiting POD, delivered, cancelled), date, customer, search; reprint,
  PDF, QR sticker, dispatch a draft, confirm POD.

## WC terminal (rebuilt on the sample)

- Page head: work center, plant · shift, clock and sync, and four figure chips (Running / ready,
  Waiting, Queue, No machine) that switch the view. Queue and job pane fill the screen under the head
  and scroll inside, so the page itself does not scroll on 1366 × 768.
- Queue panel: tabs Queue · Running / ready · Stalled · History, search, filters (material, grade,
  thickness, size, process), saved views and sort in popovers, status chips, removable filter tokens,
  and the sample's job rows (M R I C gates, size in mm and inches, layers with microns, inks, machine,
  artwork, cylinder, POD, add-ons, rolls, blockers, ⋯ menu, sales-order progress). Paged.
- Job pane: head with step, status, priority, job name and blockers; a rail of five steps; then
  Order (ordered / produced / remaining / blockers, the dark "what is to be made" plate, step figures,
  order spine, order facts · stock contract · production spec), Machine (one row per machine with its
  live state, tap to pick), Rolls (target / reserved / lineage / fallback, contract, lanes, picker),
  Input issue, Release checklist. Release bar pinned at the bottom of the pane with the gates and ⋯
  (Close short, Cancel, Recalculate from masters).
- Granule grade codes in a popup per granule: tap a code to take the balance from it (capped at its free
  stock), or pick a code with a part kg; "Next: granule" moves on.

## Scale

- Dispatch history and the Dispatch Bay figures come from `GET /api/production/challans/history/`:
  status tab, date range, customer and search are applied on the server, 8 slips a page. The page no
  longer loads every challan ever made. The logistics dashboard reads its counts the same way.
- Packing history pages on the server (60 a page). Packing and Dispatch boards page their orders and
  load line details only for the visible page. The WC queue searches on the server and pages on screen;
  WC history is filtered by date and search on the server.

## Server additions (read-only except the slips endpoint)

- `POST /api/production/challans/create-slips/` — one challan per order line and plant through the
  existing `create_challan` checks; all or none.
- `GET /api/production/packing/release-history/` — released gonnies and rolls with weights, marks, slip.
- `GET /api/production/challans/history/` — paged slips with per-tab and per-status counts, customers,
  and today's figures (slips, dispatched, vehicles, recent transporters).
- Yard snapshot: lines ready, weight still to pack, today's packed / released figures, variance count.
- Dispatch summary: per-line balances and line numbers; challan list: units, weight, line, job name.

## Not changed (awaiting the owner)

- The slip print itself (10 × 6 in, 96 columns, ESC/P prefix). Vehicle / driver / LR / job name are
  saved on the challan but not added to the printed slip.
- The yard cannot switch a line between inner packs and loose: the order's choice is used.
- No print log per slip and no cancelling of draft slips.
