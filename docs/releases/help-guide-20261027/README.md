# Help guide for every screen, in English and Hindi · machine output never blocked by inner-pouch count · 27 Oct 2026

Parent release: `66b21588772e`. No migration, no environment change, no API change.

## Fix: last machine step refused output ("primary_inner_pack.pcs_per_pack must be > 0")

Seen on SO-2026-0604 (side sealing): the order line had an inner pouch (LD-GREY-BAGS, in stock and
linked) but no pieces per inner pouch, and the inner pouch had no default either. The composer let the line
through (it only checked a typed override), and the machine then refused every output at the last step,
against the owner's rule that the inner pouch never blocks an output.

- **Machine**: pieces per inner pouch now comes from the order line, then the inner pouch's default
  (Masters → Packaging "Pouches per inner pouch (default)"), then the product master's PRIMARY_INNER
  packing line. With none, the output is saved anyway; the operator gets a notice; the batch is marked
  "count the inner packs at packing".
- **Packing Yard**: such a batch asks "Inner packs filled"; those packs become marks the evening packing
  count books to the order (one mark per unit).
- **Order entry**: the composer blocks a pouch line with an inner pouch and no pieces per inner pouch
  ("Packing: set pieces per inner pouch…"). The server fills a missing number from the customer's packing
  recipe or the product master's PRIMARY_INNER line for the same inner pouch; it does not refuse (repeat
  orders, quotations and older masters keep working), because the machine no longer stops for it.
- **To finish SO-2026-0604 cleanly**: set "Pouches per inner pouch (default)" on LD-GREY-BAGS in Masters →
  Packaging (then the machine counts them), or just log the output and count the packs at packing.

Reviewed before release by an independent multi-agent review (5 areas, every finding checked by two
skeptics) and a fix-verification pass. Also fixed from it:
- the composer's new packing blocker fires only for an inner pouch the line really carries and only on a
  real server preview; the override is kept when the pouch comes from the generic packaging axis; the
  "Using the default N" number follows the same sources as the server (line, customer recipe, master);
- the machine and job-work returns never refuse over the inner pouch (no material → logged as loose
  pouches with a notice; kg-only or 0-piece outputs → counted at packing; non-UUID ids resolved by code);
- inner packs counted at packing are weighed on the batch's own day (estimated from its pouches until the
  yard types them); typed packs cannot exceed pouches and a pouch-sized number must be confirmed;
- stock orders without pieces per inner pouch say plainly that the count shows the use as not on any order.
- Known limit: a batch logged after that day's evening count was posted is not marked in any count.

## Sales order composer: layers easier to read

The Layers column shows one layer per line: film name, thickness in large bold digits with µ, and the
grade as a bold tag, plus the total gauge for multi-layer lines. Size in mm is larger; inches are darker.

## What changed

- **Every page guide rewritten from the code** (214 screens, up from 202 guides of mostly template text).
  Each guide has what the page is for, before-you-start, numbered steps with the exact on-screen labels,
  what each field and tile means, the real error messages with their fix, what to do when stuck, related
  pages and a screenshot. Hindi is written for the floor in Devanagari; on-screen labels and error texts
  stay in English, quoted, as the screen shows them. The gate module, login and visitor pages now have
  guides too.
- **Process charts.** 44 end-to-end processes (order to dispatch, packing and release, evening count,
  closed-line goods, GRN, job work, maintenance, month end…) drawn as numbered steps with the role and the
  screen; each step opens that screen's guide. Every page shows which processes it belongs to, with the
  step before and after.
- **Decision flows** rewritten for sales orders, planning and release, the WC terminal, packing and
  release, the evening count, closed goods, dispatch, gate visitors, maintenance, quotations, buying and
  sign-in (26 flows).
- **Role guides** follow the real start pages; maintenance supervisor and technician added. A "Roles"
  document explains each role's start page, sidebar workspaces and daily routine.
- **FAQ** of the questions the floor asks (missing tick-list item, grey Place order, lost draft, closed
  goods, reprint a slip, no roll fits, Hindi, sharing…).

## Where to find it

- **Help inside the ERP** (`/help`): search across every screen, process and role; modules; processes;
  roles; English / हिंदी; Share, WhatsApp and Link buttons.
- **Public guide** (`/guide`): the same guide for anyone, no sign-in, made to share. Links keep the
  language (`?lang=hi`) and point at a page (`?page=sales-orders-create`), a process, a role or a module.
- **Header Help button**: the guide of the page you are on (steps, fields, problems, flow), loaded only
  when opened — the header no longer carries every guide in the browser.

Screenshots come from an anonymized copy of the test database (no real customer, supplier or person
names; every shot is checked against the real names before it is saved).

## Help bot sources (NotebookLM)

`docs/help-notebook/` holds 24 markdown sources built from the same content (start here, roles, one file
per module with every screen in English and Hindi, processes and flows, an index of every error message,
what is missing, release notes) and `SOURCES.md`, the upload list. Illustrated PDFs per module (screens
and charts) are generated with `frontend_v2/scripts/capture_help_pdfs.mjs` into `docs/help-notebook-pdf/`
(not committed: about 80 MB). Regenerate both after any help change:
`node frontend_v2/scripts/generate_help_notebook.mjs`.
