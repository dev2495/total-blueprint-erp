# Roll Behavior and Output Handling Implementation Report

Date: 2026-05-05
Status: GREEN for the roll behavior audit scope and local gates listed below
Commit status: no commit made

## Scope

This pass closes the gaps called out in `FINAL_AUDIT_REPORT_2026-05-05.md` for roll behavior, WIP lineage, lamination lane handling, roll output labeling, template roll policy handling, and output capture behavior. It also keeps the newer sales/product-master flow buildable locally.

## Implemented Fixes

### Template Roll Policy Resolution

- `TEMPLATE_DEFAULT` no longer overwrites behavior defaults for thickness/width rules.
- `PROCESS_DEFAULT` no longer overwrites behavior-derived operator entry mode.
- Behavior entry modes now resolve centrally:
  - `CREATE_NEW` -> `ROLL_MULTI`
  - `MODIFY_EXISTING` -> `ROLL_SINGLE`
  - `MULTI_INPUT_COMBINE` -> `ROLL_SINGLE`
  - `SPLIT` -> `GRID_SPLIT`
  - `NONE` -> `DISCRETE_ONLY`
- `TemplateProcessStepRollSpec.clean()` now rejects rules that conflict with the selected process roll behavior.

### WIP Lineage and Allocation Rules

- Downstream `MODIFY_EXISTING` now requires a lineage output roll from the same order flow.
- Raw or purchased stock is blocked for downstream `MODIFY_EXISTING` in both allocation and log-output paths.
- The WIP pool no longer exposes raw fallback rows for downstream `MODIFY_EXISTING`.
- The acceptance proof was updated from the obsolete "manual raw fallback works" expectation to the current rule: downstream raw fallback must be rejected.

### Lamination and Combine Rules

- Lane-group matching now requires every lamination lane to be covered while still allowing multiple physical rolls per lane.
- Single-pass lamination derives lane count from the actual layer stack when the order has more layers than the template default.
- Second and later lamination passes require prior laminated WIP plus the next layer.
- Missing next-layer cases now raise a clear validation error instead of silently falling back.
- `LAMINATED_WIP` slots only accept output rolls created by `MULTI_INPUT_COMBINE`.

### Roll Output Creation and Labels

- New output label suffixes make roll genealogy readable:
  - `-NEW` for `CREATE_NEW`
  - `-MOD` for `MODIFY_EXISTING`
  - `-COMB` for `MULTI_INPUT_COMBINE`
  - `-SPL` for `SPLIT`
  - `-REM` for remainders
- Roll context rows now expose `display_label`, `source_behavior`, and `created_process_name`.
- Display labels distinguish raw input, created output, split output, remainders, and FG rolls.

### Output Capture and Target Source Handling

- Roll output parsing supports gross/tare/net validation for roll rows.
- Roll-to-bulk and PCS-tracked output paths continue to require `output_pcs` where the template policy requires it.
- Execution profile/context now includes readable target source labels and details.
- Reserved step-0 roll BOM mismatches now use the actual reserved roll weight and expose a clear target source instead of silently falling to a heaviest-layer estimate.

### Acceptance and Build Cleanup

- `run_tagged_acceptance` now proves downstream `MODIFY_EXISTING` raw fallback rejection.
- Added a mechanical `materials` migration so `makemigrations --check` is green with the local Product Master/POD model changes.
- Fixed one Product Master UI type issue that was blocking the production frontend build.

## Changed Files

- `apps/production/services/services_execution.py`
- `apps/production/services/roll_allocation_service.py`
- `apps/templates/models.py`
- `apps/inventory/serializers.py`
- `apps/production/management/commands/run_tagged_acceptance.py`
- `apps/production/tests/test_roll_assignment_fallback.py`
- `apps/production/tests/test_machine_terminal_endpoints.py`
- `apps/materials/migrations/0023_alter_commercialfamily_default_reporting_group_and_more.py`
- `frontend_v2/src/app/(dashboard)/master/product-master/[id]/page.tsx`

## Verification

All commands below passed locally:

```bash
env PYTHONPYCACHEPREFIX=/private/tmp/roll_pycache python3 -m py_compile apps/production/services/services_execution.py apps/production/services/roll_allocation_service.py apps/inventory/serializers.py apps/templates/models.py apps/production/management/commands/run_tagged_acceptance.py apps/production/tests/test_roll_assignment_fallback.py apps/production/tests/test_machine_terminal_endpoints.py
```

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py test apps.production.tests.test_roll_assignment_fallback apps.production.tests.test_machine_terminal_endpoints --noinput --keepdb --verbosity 1
```

Result: 26 tests OK.

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py test apps.production.tests_roll_behavior_rules --noinput --keepdb --verbosity 2
```

Result: 7 tests OK.

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py test apps.production.tests.test_wip_route_truth --noinput --keepdb --verbosity 2
```

Result: 6 tests OK.

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py check
```

Result: system check identified no issues.

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py makemigrations --check --dry-run --verbosity 2
```

Result: no changes detected.

```bash
env SKIP_DOTENV_IMPORT=1 SKIP_CELERY_IMPORT=1 venv/bin/python manage.py run_tagged_acceptance --noinput --suite default
```

Result: tagged acceptance flow completed. Artifacts written to `.runtime/acceptance`.

```bash
npm run help:validate
npm run nav:validate
npm run typecheck
npm run build
```

Result: all frontend gates passed. Build has one existing Next.js font warning in `src/app/layout.tsx`; it does not fail the build.

## Unsupported Audit Command Note

The audit suggested:

```bash
venv/bin/python manage.py run_tagged_acceptance --tag=roll_behavior
```

That is not a valid command for this repo. The command exits with `unrecognized arguments: --tag=roll_behavior`. The valid local acceptance gate available here is:

```bash
venv/bin/python manage.py run_tagged_acceptance --noinput --suite default
```

That valid suite is green.

## Local Worktree Note

The checkout already contains a broad dirty tree from the newer sales/product-master/planner work. This pass did not commit anything. Review the changed files above for this roll audit scope before go-live.
