# Stock Order Launcher Upgrades

## Goal

Rebuild the planner stock-order create page into a compact, cart-first launcher that works on low-resolution production desks without changing backend stock-order logic.

## What Changed

### Layout

- Replaced the tall multi-section page with a fixed-height launcher shell.
- Compressed the top area into a single header bar with:
  - back button
  - lane toggle
  - output toggle
  - cart count
  - release-all action
- Split the body into:
  - a left work column for source selection and line composition
  - a right cart rail for queued lines and batch release
- Removed the old vertical variant card rail and switched to inline selects with search filtering.
- Added a compact source explanation row so operators immediately understand when route start/stop is editable versus seeded from a planner preset.
- Added compact source chips for current source, template, and output mode so the operator can confirm intent without opening the spec editor.
- Kept the spec editor collapsible so the main workflow stays visible on 1024x768 class screens.

### Business Logic Presentation

- Sales SKU lane now explicitly shows route start and route stop inputs.
  - This matches the intended rule: sales SKU provides commercial spec truth, while planner chooses route span at launch time.
- Planner SKU lane keeps route information seeded and readonly in the compact composer.
- Custom lane keeps route start and stop editable.
- KG and PCS are always shown in both the composer preview strip and cart rows.
  - When a value is not derivable, the UI shows `—kg` or `—pcs` instead of hiding the field.

### Cart Flow

- Added `Add line to cart` to snapshot the current launch config into a queued line.
- Added `Release all` action in the header and cart footer.
- Release iterates queued lines and:
  1. creates a stock order
  2. releases that order to production
  3. optionally saves the line as a planner preset
- Each cart row tracks its own status:
  - `draft`
  - `submitting`
  - `released`
  - `failed`

### Flow Integrity

- Backend endpoints and stock-order creation payloads were left intact.
- Existing create-and-release behavior still uses:
  - `plannerService.createStockOrder(...)`
  - `plannerService.releasePlannedOrder("stock", orderId)`
- Preset-save behavior still uses existing planner SKU and planner SKU variant APIs.

## Before / After

### Before

- Separate topbar, toolbar, source rail, metrics strip, and bottom action area
- Too much padding and card chrome
- Variant selection consumed excessive vertical space
- Single-order feel even though cart logic had been added

### After

- One-line operator header
- Inline source selection
- Compact single-panel composer
- Independent scroll regions
- Dense cart rail with batch release
- Fewer repeated labels and less wasted vertical space

## Responsive Behavior

- `>= 1200px`
  - cart rail expands
  - slightly more breathing room
- `<= 1024px`
  - tighter pills and search field
  - cart rail remains narrow
- `<= 900px`
  - layout stacks into a single column
  - cart becomes a lower panel
- `<= 720px`
  - form rows collapse vertically

## Verification Notes

- Frontend build must pass with `npm run build`.
- UI observation tests for the compact launcher were updated to match the new structure.
- Dry-fruit observation flow was updated so its create-order launcher assertions target the new compact controls instead of the removed variant rail.
