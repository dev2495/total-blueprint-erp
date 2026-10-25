# Closed-order goods, Dispatch Bay tabs, packing audit · 26 Oct 2026

Parent release: `c5644012d0c4`. No migration, no environment change.

## Goods made for a closed line or order

A line can be short-closed, completed or cancelled (or the whole order completed / cancelled) while
rolls, gonnies or pouches made for it are still in the yard. Until now Dispatch Bay showed them as ready
and then refused the slip ("SO-… is COMPLETED; a challan cannot be created"). Now the owner's rule
applies: those goods may go **either** way, decided at dispatch.

- **Ship them to the customer.** Dispatch Bay marks the line ("Order completed" / "Line short-closed")
  and shows the real quantities (ordered, closed, made and waiting) instead of "Ordered 0 kg". Loading it
  shows a box on the tray, *Send goods of closed lines*, that must be ticked before Create and Mark
  dispatched. The server refuses a closed line without that confirmation (create-slips and dispatch both
  take `ship_closed_lines`). Proof of delivery never reopens or rewrites a closed line or order.
- **Move them to free stock.** "Move to stock" on the line (Dispatch Bay or Packing Yard) picks the
  rolls, sealed gonnies and unpacked batches with a reason. They leave the order and Dispatch Bay and
  keep a record of where they came from. The planner's *use finished stock* now offers them to any order
  with the same specification (rolls, batches and whole sealed gonnies). Units of an open line, units on
  a draft slip and dispatched units cannot move.
- A draft order still never dispatches. A draft slip whose line closes afterwards needs the same
  confirmation to leave (History shows "Line closed" and asks before dispatching it).

`POST /api/production/challans/move-to-stock/` · `{roll_ids?, gonny_ids?, batch_ids?, reason}`

## Dispatch Bay

Three tabs: **Ready to dispatch** (board + loading tray), **This load** (the slips just created with the
exact Epson text, print, PDF, QR, mark dispatched; opens by itself after Create), **Challans & history**
(drafts, awaiting POD, delivered, cancelled; search, dates, customer; reprint, dispatch a draft, confirm
POD). The figure tiles open the matching tab. The order page links to its slips:
`/logistics/dispatch?history=SO-…`.

## Packing audit

Same rule as before (only inner pouches are taken at packing; gonny, box, tape and extras are ticked at
release and booked by the evening count to the lines that ticked them), shown in three views:

- **Evening counts**: one card per count with, per material, book → counted → used, the ticks, and the
  share each order line took (with line numbers). A warning shows when the ticks differ from what was
  counted. Usage not on any order and stock found above the book are shown too.
- **Inner pouches · at packing** and **Ticks at release** (each tick says whether a count has booked it).
- Pieces are shared in whole pieces from now on: 1 gonny counted used goes to one line, not 1/14 of a
  gonny to fourteen lines. Bookings made before this release keep their old fractional shares.

`GET /api/production/packing/count-sessions/` · `order-consumption/?view=inner|count|ticks`
