# Verification Matrix

This file is the only supported verification map for release decisions.

## Release gates

These checks must pass before staging signoff and before production deployment:

1. Backend deploy safety
   - `venv_311/bin/python manage.py check --deploy`
2. Backend regression suite
   - `venv_311/bin/python manage.py test --noinput`
3. Tagged acceptance
   - `venv_311/bin/python manage.py run_tagged_acceptance --noinput`
4. Physics and stock-matching smoke
   - `venv_311/bin/python scripts/verify_physics_math.py`
   - `venv_311/bin/python scripts/verify_fg_semi_match.py`
5. Frontend quality
   - `cd frontend_v2 && npm run lint`
   - `cd frontend_v2 && npm run typecheck`
   - `cd frontend_v2 && npm run build`
6. Browser UI release suite
   - `cd frontend_v2 && npm run e2e:ui`

## Maintained non-gating helpers

These are useful for focused debugging, but they are not standalone release gates:

- `scripts/verify_phase_*.py`
- `scripts/run_semi_fg_3_sales_fixture.py`
- `scripts/simulate_production.py`
- `scripts/e2e_total_test.py`

Use them only for targeted investigation or data seeding, not as proof of release readiness.

## Removed stale verification scripts

The following scripts were removed because they no longer match the current stock-strategy, planner/WCM, and snapshot-based sales flows:

- `verify_physics_e2e_flow.py`
- `verify_physics_e2e_pouch_flow.py`

Do not recreate these root-level one-off scripts. Extend the maintained checks above instead.

## Verification ownership

- Backend correctness: Django test suite + tagged acceptance
- Physics/math correctness: `verify_physics_math.py`, `verify_fg_semi_match.py`, and targeted regression tests
- UI and workflow correctness: Playwright suite
- Deploy safety: `check --deploy` with the production env template
