# Sales, Product Master, Label, And Axis Go-Live Checklist - 2026-06-29

Target branch: `codex/planner-sales-latest-20260629`

Target worktree: `/Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree`

## Scope

Ship the sales-create and Product Master axis changes on top of the latest planner-control-tower worktree so planner, sales, production, packing, and dispatch can go live together with one consistent product label and one backend-owned version model.

## Decisions Locked

- Product Master version, template version, and route version stay hidden from frontend users. Backend keeps current-version enforcement.
- Sales receives only active/order-ready Product Masters; Product Master version/current status is not shown to frontend users.
- If a customer overlay label exists, the product label starts with that customer-facing label.
- The product label shows size and layer stack separately.
- Film thickness stack is condensed as `12+40` and material stack as `PET/LD`.
- Grade code is shown only where it helps identify extrudable/recipe-driven film, for example `LD65 GP`.
- Ink and adhesive are summarized separately as `I2/A&S1`. Ink GSM comes from artwork; EOD ink issue remains execution/stock truth.
- Ad-hoc values are allowed only through Product Master-governed axes, not arbitrary unknown order dropdowns.
- Product Master create captures route/template plus layer count only; new masters stay inactive while layer film/grade/thickness setup is pending.
- Outer packing remains EOD/packing-yard truth unless explicitly enabled as an order axis later.

## Checklist

- [x] Add shared backend label/spec builder.
- [x] Add backend tests for customer-first labels, thickness/material separation, and hidden versions.
- [x] Wire Sales Order create/preview to persist the canonical line label and material issue policy snapshot.
- [x] Add Product Master axis metadata for sales-governed ad-hoc values.
- [x] Update downstream planner, production, packing, dispatch, PDF, search, and serializer labels.
- [x] Add frontend label utility mirroring the backend display contract.
- [x] Rework sales create flow to qty/price first, then current Product Master and allowed axes.
- [x] Add live BOM expandable groups for film, ink, adhesive/chemicals, add-ons, POD, packing, and policy.
- [x] Update Product Master create/edit workspace for layer count, layer options, source mode, and sales axis contract.
- [x] Remove editable adhesive/solvent GSM from sales create; display read-only Product Master chemistry and submit PM-owned chemical material rows.
- [x] Replace raw wastage policy key input with live material-plan policy rows showing template default, planned issue, order override, value, and reason.
- [x] Add Product Master per-layer allowed film alternates plus the `layer_material_overrides` axis control.
- [x] Add ad-hoc allowed/blocked controls in Product Master axis cards and catalog allow-list cards.
- [x] Make ad-hoc size visible in Sales Create: active `+ New size` when the Product Master allows it, blocked state when it does not.
- [x] Add route graph rendering to Product Master edit so live route/parallel branches are visible from the route template.
- [x] Polish Sales Create dark mode, line table, empty state, and live BOM rail to match the final mockup direction.
- [x] Replace the hard-coded light Sales Create route background with the semantic sales canvas so dark mode has no white gutters.
- [x] Add mockup-style line-table separators, total column, and active-line rail in Sales Create.
- [x] Render accessible layer-film dropdowns whenever a layer has more than one Product Master-approved film option.
- [x] Make the Product Master-governed ad-hoc pouch size path explicit before showing width, height, gusset, stock form, and pouch-style fields.
- [x] Remove user-facing Product Master/template/route version labels from sales and high-volume operational screens.
- [x] Run backend targeted tests.
- [x] Run frontend typecheck.
- [x] Run frontend production build.
- [x] Run clean restart after stale Next duplicate chunks were found.
- [x] Attempt frontend lint; full and changed-file lint runners stalled without diagnostics, so this is documented as a tooling issue.
- [x] Run browser regression for sales create, Product Master create/edit, planner command, and dispatch page visibility.
- [x] Remove the redundant Sales Order list/detail line-preview block so each line label appears once in the high-volume list row.
- [x] Propagate the canonical customer-first line label through Sales Order list, detail, dispatch create, logistics dispatch, planner queue, WCM queue, and dispatch PDF.
- [x] Hide single-line fulfillment legends that repeated `Line 1`; multi-line legends now use the same canonical labels.
- [x] Add a visible Product Master `Sales ad-hoc permissions` strip so PM-governed ad-hoc pouch/size/add-on/POD/packing controls are discoverable before sales entry.
- [x] Update the done report with exact files changed, decisions, tests, and residual risks.

## Verification Evidence

- Backend focused tests: `venv_311/bin/python manage.py test apps.materials.tests_product_spec_label apps.materials.tests_product_master.ProductMasterApiTests.test_geometry_axis_rejects_ad_hoc_size_unless_axis_allows_it apps.materials.tests_product_master.ProductMasterApiTests.test_create_allows_inactive_pending_layer_slots_but_not_active apps.sales.tests.test_sales_product_label_contract apps.sales.tests.test_sales_order_list_summary.SalesOrderListSummaryTests.test_serializer_builds_item_qty_and_fulfillment_summaries_for_pouch_lines`
- Backend system check: `venv_311/bin/python manage.py check`
- Local wrapper deep verify: `env BACKEND_PYTHON=venv_311/bin/python ./start_all.sh verify`
- Frontend typecheck: `npm run typecheck`
- Frontend production build: `npm run build`
- Runtime clean restart/deep verify: `./start_all.sh clean-restart`
- Browser proof: `node .runtime/ui-e2e/sales-pm-label-axis/browser-check.mjs`
- Browser screenshots: `.runtime/ui-e2e/sales-pm-label-axis/sales-create.png`, `product-master-create-modal.png`, `product-master-edit-contract.png`, `planner-command.png`, `dispatch-bay.png`
- Correction browser smoke: sales create customer-selected state and Product Master edit.
- Correction screenshots: `.runtime/ui-smoke/sales-after-customer.png`, `.runtime/ui-smoke/pm-edit-smoke.png`
- Final correction browser smoke: enabled `PM-UAT-GREEN-DRYFRUIT` size axis `allow_ad_hoc/allow_custom`, selected customer + Product Master in Sales Create, verified active `+ New size`, no visible version/current-master language, live BOM rail, Product Master route graph, allowed film variants, and grade/no-grade state.
- Final correction screenshots: `/private/tmp/sales-create-final-light.png`, `/private/tmp/sales-create-final-dark.png`, `/private/tmp/product-master-edit-final-dark.png`
- Final polish correction browser smoke: selected `PM-UAT-GREEN-DRYFRUIT` with local QA layer alternates, verified dark semantic canvas, 6 line separators, 2 layer-film dropdowns, visible ad-hoc pouch-size fields, and clean post-login console baseline.
- Final polish screenshots and JSON: `.runtime/ui-e2e/sales-pm-label-axis/final-polish/sales-empty-dark.png`, `.runtime/ui-e2e/sales-pm-label-axis/final-polish/sales-line-dark-polished.png`, `.runtime/ui-e2e/sales-pm-label-axis/final-polish/final-polish-check.json`
- Final polish gates: `npm run typecheck`, `npm run build`, `bash ./start_all.sh restart`, `node .runtime/ui-e2e/sales-pm-label-axis/final-polish-check.mjs`, and `bash ./start_all.sh verify`.
- Sales list/detail/downstream label correction tests: `venv_311/bin/python manage.py test apps.materials.tests_product_spec_label apps.sales.tests.test_sales_product_label_contract apps.sales.tests.test_sales_order_list_summary apps.production.tests.test_planner_control_hub_semantics apps.production.tests.test_dispatch_pdf_output apps.production.tests.test_machine_terminal_endpoints`
- Sales list/detail/downstream label correction build: `npm run build`
- Sales list/detail/downstream label correction browser smoke: `node .runtime/ui-e2e/sales-list-label-fix/check.mjs`
- Sales list/detail/downstream label correction wrapper verify: `bash ./start_all.sh verify`
- Git push: `git push origin HEAD:main`, updating `origin/main` from `ba4ce6c` to `162ad01`.
- AWS source sync: rsynced committed source to `/opt/tpp-erp/app` on `3.6.77.159` with runtime/build/cache folders excluded.
- AWS build: `sudo docker compose -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml build backend frontend worker beat`
- AWS backend checks: remote `python manage.py check` passed; remote `python manage.py migrate --noinput` reported no migrations to apply.
- AWS release: recreated backend, frontend, worker, and beat; backend/frontend containers reported healthy.
- AWS live probes: `ready`, `sales/orders`, `sales/orders/create`, `master/products`, Product Master edit, planner live, stock launcher, dispatch, and machine selector returned HTTP 200.
- AWS source hash audit matched local and server copies for `sales-orders-list.tsx`, `product-master-edit.tsx`, `product_spec.py`, and `views_planner.py`.
