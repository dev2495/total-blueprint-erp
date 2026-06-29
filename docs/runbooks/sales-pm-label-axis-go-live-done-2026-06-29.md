# Sales, Product Master, Label, And Axis Go-Live Done Report - 2026-06-29

Status: Complete for implementation and runtime verification on branch `codex/planner-sales-latest-20260629`.

Worktree: `/Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree`

## Decisions Preserved

- Backend owns Product Master, template, and route versions. Frontend users see active/order-ready operational choices only.
- Sales create uses active/order-ready Product Masters and never exposes a version picker or current-version wording.
- If a customer overlay/customer label exists, it starts the line label.
- The canonical label separates size, layer thickness, layer material/grade, print, add-ons, POD, packing, and quantity.
- Thickness stack is condensed, for example `12+40`; material/grade stack stays separate, for example `PET/LD65 GP`.
- Ink and adhesive/solvent are summarized as `I2/A&S1`; ink GSM comes from artwork assignment while EOD ink issue remains stock/execution truth.
- Ad-hoc pouch, size, add-on, POD, and packing choices stay bounded by Product Master axes.
- Product Master create captures identity, route/template, and number of layers only; detailed layer setup happens in the edit workspace before activation.
- Outer packing remains an EOD/packing-yard truth unless Product Master axes explicitly allow it later.

## What Changed

- Added a shared backend product-spec/line-label builder in `apps/materials/product_spec.py`.
- Sales order create now stores canonical `line_name`/`line_label` snapshots and issue-policy overrides.
- Sales serializers expose `line_label`, `product_spec`, `layer_stack`, and `chemistry` for list/detail/repeat flows.
- Planner queue, production serializers, and dispatch PDF now prefer the canonical customer-first line label.
- Product Master validation supports inactive setup-pending layer slots for the new create flow, while still blocking active masters until layers are fully configured.
- Axis validation now supports PM-governed ad-hoc/custom values through axis metadata.
- Sales create UI now starts with qty/price, then current Product Master and allowed axes, with a live label strip used across downstream pages.
- Sales create no longer exposes editable adhesive/solvent GSM; adhesive and solvent GSM/materials are read from Product Master fixed attributes, while ink GSM remains artwork-derived.
- Sales create wastage now works from live material-plan rows instead of a raw `FILM:...` policy-key input, showing theory, planned issue, template default, override mode/value, and reason.
- Sales BOM preview now uses expandable film, ink, adhesive/chemicals, add-ons, POD, packing, and policy groups.
- Product Master create modal now asks for layer count and creates inactive pending layer rows.
- Product Master edit workspace now has a sales/planner contract card covering layer contract, order axes, source mode, ad-hoc rules, and issue policy.
- Product Master edit now exposes `layer_material_overrides` as "Per-layer film variant", stores default film plus allowed alternates per layer, and keeps backend aliases such as `allowed_film_variant_codes`/`film_variant_options`.
- Product Master axis cards and catalog allow-list cards now expose ad-hoc allowed/blocked controls so sales can only request new values when the master allows it.
- Product Master edit dropdowns and allowed-axis chips were hardened against duplicate catalog codes, removing the React duplicate-key warning seen in browser verification.
- Version wording was removed from sales and high-volume Product Master screens; backend versioning remains intact.
- Dark mode tokens were tightened from muddy gray panels to the same navy/ink system used by the approved sales mockup, with stronger contrast for cards, rails, inputs, and status chips.
- Sales Create route chrome now uses a semantic sales canvas instead of a hard-coded light gradient, so dark mode no longer leaves white gutters around the workspace.
- Sales Create now keeps the mockup-style `Lines` table even in empty state, then opens the qty/price-first line workspace with label spine, size/ad-hoc controls, per-layer axes, route-derived lane plan, material-wise BOM rail, readiness, and issue-policy evidence.
- Sales Create line rows now match the final mockup structure more closely: fixed columns, visible vertical separators, active-line rail, qty, total, artwork, and status cells.
- Sales Create shows ad-hoc size as an explicit Product Master-governed control: `+ New size` when the PM axis allows it, and a blocked tile when the PM axis does not.
- Sales Create now renders layer-film selectors whenever that layer has more than one Product Master-approved film option, and those selectors have accessible labels for keyboard/browser verification.
- Product Master edit now renders the route graph from live route steps and exposes the size-axis ad-hoc flag as `Ad-hoc size in sales`.
- Product Master edit keeps allowed film variants and grade state visible per layer; purchased-only film paths explicitly hide grade selection, while extrusion/grade-capable paths use the allowed grade list.
- Sales Order list now removes the redundant nested line-preview card in compact rows; the line is shown once with the same canonical label used downstream.
- Sales Order list/detail fulfillment legends no longer repeat `Line 1` for single-line orders, and multi-line legends use the exact canonical line labels instead of synthetic `L1` text.
- Sales detail, dispatch creation, logistics dispatch, planner queue, WCM queue, and dispatch PDF now all prefer the persisted/backend-rebuilt canonical label before falling back to legacy product names.
- Product Master edit now includes a visible `Sales ad-hoc permissions` strip in the variant-axis workspace so users can see and toggle PM-governed ad-hoc pouch, size, add-on, POD, and packing availability.

## Verification

- Passed: backend focused tests.
  - `venv_311/bin/python manage.py test apps.materials.tests_product_spec_label apps.materials.tests_product_master.ProductMasterApiTests.test_geometry_axis_rejects_ad_hoc_size_unless_axis_allows_it apps.materials.tests_product_master.ProductMasterApiTests.test_create_allows_inactive_pending_layer_slots_but_not_active apps.sales.tests.test_sales_product_label_contract apps.sales.tests.test_sales_order_list_summary.SalesOrderListSummaryTests.test_serializer_builds_item_qty_and_fulfillment_summaries_for_pouch_lines`
- Passed: backend check.
  - `venv_311/bin/python manage.py check`
- Passed: local stack deep verify.
  - `env BACKEND_PYTHON=venv_311/bin/python ./start_all.sh verify`
- Passed: frontend typecheck.
  - `npm run typecheck`
- Passed: frontend production build.
  - `npm run build`
- Passed: clean restart and deep route/asset verification after stale duplicate `.next` chunks were found.
  - `./start_all.sh clean-restart`
- Passed: browser smoke/regression.
  - `node .runtime/ui-e2e/sales-pm-label-axis/browser-check.mjs`
  - Covered `/sales/orders/create`, Product Master create modal, Product Master edit contract card, `/dashboard/planner/control-tower/command`, and `/logistics/dispatch`.
  - Screenshots were written to `.runtime/ui-e2e/sales-pm-label-axis/`.
- Passed: correction browser smoke.
  - Sales create after selecting `Agnee Bakers`: qty/price appeared, Product Master picker appeared, and old `Adh + solvent GSM` input was absent.
  - Product Master edit for `PM-AUTO-70C1398F`: ad-hoc controls, "Per-layer film variant", and allowed film variant controls rendered.
  - Screenshots were written to `.runtime/ui-smoke/sales-after-customer.png` and `.runtime/ui-smoke/pm-edit-smoke.png`.
- Passed: final correction browser smoke.
  - Authenticated browser selected customer, selected `PM-UAT-GREEN-DRYFRUIT`, verified `allow_ad_hoc=true` and `allow_custom=true` on the size axis, and confirmed active `+ New size`.
  - Sales Create checks passed for line label table, selected Product Master, no version/current-master language, artwork/not-print-capable state, and live BOM rail.
  - Product Master edit checks passed for route graph, size ad-hoc control, allowed film variants, grade/no-grade state, and no version/current-master language.
  - Screenshots were written to `/private/tmp/sales-create-final-light.png`, `/private/tmp/sales-create-final-dark.png`, and `/private/tmp/product-master-edit-final-dark.png`.
- Passed: final polish browser smoke.
  - Local QA Product Master `PM-UAT-GREEN-DRYFRUIT` was given PM-approved layer alternates to exercise the selectable layer-film path on the live Sales Create page.
  - Browser verified dark semantic canvas, 6 line-table separators, 2 accessible layer-film dropdowns, visible ad-hoc pouch-size fields, and clean post-login console baseline.
  - Evidence was written to `.runtime/ui-e2e/sales-pm-label-axis/final-polish/final-polish-check.json`, `sales-empty-dark.png`, and `sales-line-dark-polished.png`.
- Passed: final wrapper deep verify after the polish correction.
  - `bash ./start_all.sh verify`
- Passed: sales list/detail/downstream label correction backend regression.
  - `venv_311/bin/python manage.py test apps.materials.tests_product_spec_label apps.sales.tests.test_sales_product_label_contract apps.sales.tests.test_sales_order_list_summary apps.production.tests.test_planner_control_hub_semantics apps.production.tests.test_dispatch_pdf_output apps.production.tests.test_machine_terminal_endpoints`
  - 57 tests OK.
- Passed: sales list/detail/downstream label correction production frontend build.
  - `npm run build`
- Passed: sales list/detail/downstream label correction local browser smoke.
  - `node .runtime/ui-e2e/sales-list-label-fix/check.mjs`
  - Verified `/sales/orders`, `/sales/orders/:id`, Product Master edit ad-hoc visibility, and planner route render without 5xx or runtime JavaScript failures.
  - Evidence label: `Dry Fruit Fresh Route - 200x200 - 12+40 - UAT-GREEN-PET/UAT-GREEN-PE - I1.2 - FLEXO2C - 2200 PCS`.
- Passed: final wrapper deep verify after the sales list/detail/downstream label correction.
  - `bash ./start_all.sh verify`

## AWS Go-Live

- Pushed the release code to GitHub `main`.
  - `git push origin HEAD:main`
  - Remote advanced from `ba4ce6c` to `162ad01`.
- Synced the committed source to AWS Lightsail host `3.6.77.159` / `erp.totalpolyprint.com` under `/opt/tpp-erp/app`, excluding local runtime/build/cache folders.
- Built production Docker images on AWS.
  - `sudo docker compose -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml build backend frontend worker beat`
  - Backend, frontend, worker, and beat images built successfully.
- Ran remote backend safety checks.
  - `python manage.py check`: passed with no issues.
  - `python manage.py migrate --noinput`: no migrations to apply.
- Recreated production backend, frontend, worker, and beat containers.
  - Backend and frontend reported healthy.
  - Worker connected to Redis and reported ready.
  - Beat started and dispatched scheduled tasks normally.
- Probed live production routes after recreate; all returned HTTP 200:
  - `https://erp.totalpolyprint.com/api/health/ready/`
  - `https://erp.totalpolyprint.com/sales/orders`
  - `https://erp.totalpolyprint.com/sales/orders/create`
  - `https://erp.totalpolyprint.com/master/products`
  - `https://erp.totalpolyprint.com/master/products/6f7a1d02-0b01-4d9f-8946-11acc34507d5/edit`
  - `https://erp.totalpolyprint.com/dashboard/planner/control-tower/live-production`
  - `https://erp.totalpolyprint.com/production/planner/stock-launcher`
  - `https://erp.totalpolyprint.com/logistics/dispatch`
  - `https://erp.totalpolyprint.com/production/machine-selector`
- Source hash audit matched local and AWS server files for the core release surfaces:
  - `frontend_v2/src/components/sales-orders/sales-orders-list.tsx`
  - `frontend_v2/src/components/product-master/product-master-edit.tsx`
  - `apps/materials/product_spec.py`
  - `apps/production/views_planner.py`

## Residual Risk

- `npm run lint` did not produce diagnostics or exit after roughly 150 seconds, and a changed-file lint command also stayed silent after roughly 90 seconds. The verified gates for this branch are therefore backend tests, Django check, wrapper deep verify, frontend typecheck, production build, and browser regression.
- The lint behavior looks like a repo tooling/performance issue rather than a feature diagnostic. Official ESLint/TypeScript-ESLint guidance points to using debug/stats, caching, and tightening TypeScript project/include configuration; changing that lint setup should be handled as a separate tooling cleanup, not mixed into this feature branch.
