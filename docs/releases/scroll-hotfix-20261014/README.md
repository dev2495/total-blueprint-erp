# Hotfix: planner release dialog could not scroll

- **Base:** live `e1bed53d6539` (UI polish, 14 Oct 2026).
- **Reported:** 14 Oct 2026 12:52 IST by the client (WhatsApp screenshot of "Release planning SO-2026-0628": "not able to scroll here on this window").
- **Cause:** since 30 Sep (`e92acec`) the dialog body was a `<fieldset>` used as the scroll container inside a flex column. Chrome does not scroll a fieldset's own overflow, and a fieldset flex item does not shrink, so content below the fold was clipped by the dialog box. On shorter screens the "Release immediately after planning" option was out of reach. The 12 px caption floor in the UI-polish release made the body a little taller, which is why it surfaced now.
- **Fix:** the scroll container is a `div` wrapping the fieldset (`overflow-y: auto; flex: 1; min-height: 0`); the fieldset keeps its `disabled` gating of every control, so behaviour is unchanged. The artwork picker dialog's scroller gained `min-height: 0` for the same shrink reason.
- **Verified locally (dev stack, 1280×720 and 1280×480):** release dialog wheel-scrolls, bottom reachable, option checkbox visible; artwork picker shrinks without clipping; typecheck, lint, theme-token guard pass.
- **No logic, field, API or schema change.** Frontend-only deploy, no migration, no env change.
