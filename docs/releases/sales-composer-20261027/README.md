# Sales order composer, release tick list · 27 Oct 2026

Parent release: `158e12a38ce5`. No migration, no environment change, no API change.

## Sales → Orders → Create, on the approved sample

The order payload sent to the planner is unchanged (same fields, same checks, same blockers). What changed
is how the order is put together:

- **Start.** Until a customer is set the page asks one question, *Who is this order for?*: type two letters
  (arrow keys + Enter pick), a recent customer, or the full list. A draft left in this browser is offered
  (*Resume draft* / *Start fresh*); drafts autosave as you type and the header shows *Draft saved hh:mm*.
- **Order facts in one row.** Customer (click to change), Ship to, Promised dispatch with "in N days",
  Plant (Auto · planner), Job name, Ship address and Note for dispatch (both open a small editor; blank
  address still means the saved one, and the saved one is shown).
- **Lines table.** One row per line: product and line label, size in mm with inches, layers with the total
  gauge, print (Roto/Flexo, colours, artwork or "artwork later"), quantity, rate, value and a status that
  names the first thing missing ("Needs rate", "Needs artwork" …). A totals row adds lines, kg + pcs and ₹.
  Row menu: duplicate, move up/down, remove (with Undo). Keys on a row: Enter opens, D duplicates,
  Alt ↑/↓ moves, Delete removes.
- **Quick-add row.** Product (⌘K) → size → qty → unit → rate → Enter adds the line without opening
  anything; Shift+Enter or *Editor* opens it. A product that prints or packs into pouches is added as
  *Check the line* and cannot be placed until it is opened once, so artwork and packing are never skipped.
  *Quick Start* (last order, customer items) sits under it as before.
- **Line drawer.** *Add line* (Alt N) or a row opens the full line editor in a wide drawer: line tabs with
  status dots, Alt ←/→ between lines, the step chips, the spec plate and live preview on the right.
  Footer: Remove, Duplicate, status, value, *Done with this line*, *Save & add another*.
- **Before you place / Customer.** Two chips under the lines open the readiness list (each item has
  *Fix →*: opens that line or puts the cursor in the field) and the customer's history panel. The place
  bar keeps Make for stock, Save as quotation and Place order (⌘↵); its blocker pill opens the same list.
- **After placing.** A summary replaces the jump to the orders list: order number and job name, lines,
  quantity, value, promised dispatch, what was sent, and Open order / Open in planner /
  New order for the same customer / New order. The placed draft is cleared.

## Release tick list: one rule

Inner pouches are never in the list: they are taken off stock automatically at packing. **Every other active
packing item is always listed** (gonny, sheet, putha, box, tape, label, tag, outer bag, other), on roll and pouch
releases alike, and any number can be ticked per release. Ticks are marks only; the evening count books the use.

- Masters → Packaging no longer defaults a new item to *Inner pouch* (that default is how Putha dropped out of
  the list): it starts with no kind (*What is this item?*), will not save until one is picked, and each kind says
  how the yard uses it. Item cards show the same line.
- The evening count now counts an item **once per unit**, however many times it was marked on that unit (the
  gonny chosen when a pouch unit is sealed and the same gonny ticked again at release), so showing gonny on
  pouch lines cannot skew the split between orders. An explicit quantity is kept.

**Data step after go-live (owner):** open Masters → Packaging, set *Putha* to *Sheet · putha · board* (any kind
except Inner pouch works) and make sure it is active. It then shows in the tick list.
