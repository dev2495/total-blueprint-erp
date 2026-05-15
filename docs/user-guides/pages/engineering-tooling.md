# Tool Room

## Route
- /engineering/tooling

## Module
- Engineering

## Roles
- ADMIN
- OWNER
- SUPER_ADMIN
- ENGINEERING


## Summary (EN)
Tool Room keeps artwork, color, tooling, and approval readiness visible before production release.

## Summary (HI)
Tool Room स्क्रीन उपयोगकर्ताओं को सही डेटा, स्थिति और अगला कार्य स्पष्ट रूप से दिखाती है।

## Purpose (EN)
Use Tool Room to complete the page workflow without guessing which status, filter, or approval step comes next.

## Purpose (HI)
Tool Room का उपयोग करके अगला status, filter या approval step बिना भ्रम के पूरा करें।

## Prerequisites (EN)
- Confirm your role, plant, and operating context before changing records.
- Open the upstream order, master, job, or ledger source before approving downstream impact.


## Prerequisites (HI)
- रिकॉर्ड बदलने से पहले अपनी भूमिका, प्लांट और संचालन संदर्भ की पुष्टि करें।
- डाउनस्ट्रीम प्रभाव अनुमोदित करने से पहले अपस्ट्रीम order, master, job या ledger स्रोत खोलें।


## Key Actions (EN)
- Review the page summary, filters, and pending cards before taking action.
- Open the target record and verify mandatory fields, status, owner, and references.
- Submit only after previewing the operational impact, then confirm toast, audit, and refreshed totals.


## Key Actions (HI)
- कार्रवाई से पहले page summary, filters और pending cards देखें।
- लक्ष्य record खोलकर mandatory fields, status, owner और references जांचें।
- Operational impact preview करने के बाद ही submit करें, फिर toast, audit और refreshed totals जांचें।


## Field Help
- **Context** (EN): Plant, role, and date/FY filters decide which records and actions are valid.
  - **Context गाइड** (HI): Plant, role और date/FY filters तय करते हैं कि कौन से records और actions वैध हैं।
- **Status** (EN): Treat status as the gate. If the next action is hidden, check role access and required upstream approval.
  - **Status गाइड** (HI): Status को gate मानें। अगला action छिपा हो तो role access और required upstream approval जांचें।
- **Audit Notes** (EN): Write the reason, reference, and approver when the action changes stock, approval, or user visibility.
  - **Audit Notes गाइड** (HI): Stock, approval या user visibility बदलने वाली action में reason, reference और approver लिखें।

## Decision Flow
- engineering-approval-flow
1. Draft technical definition
   - Outcomes: Ready for review, Incomplete
2. Approve with signoff
   - Outcomes: Approved

## Common Errors
- **EN:** Action hidden or permission denied - Role, module permission, or governance visibility does not allow this step.
  - **HI:** Action hidden or permission denied गाइड - Role, module permission या governance visibility इस step की अनुमति नहीं देता।
- **EN:** Validation failed - Required context, source record, quantity, date, or approval status is missing or inconsistent.
  - **HI:** Validation failed गाइड - Required context, source record, quantity, date या approval status missing/inconsistent है।

## Recovery Steps (EN)
- Refresh the page, reselect filters, and reopen the record from the list.
- Check the upstream source and fix missing master/order/job/approval data before retrying.
- If the issue remains, capture route, payload, screenshot, and timestamp for the admin audit log.


## Recovery Steps (HI)
- Page refresh करें, filters फिर चुनें और list से record दोबारा खोलें।
- Retry से पहले upstream source में missing master/order/job/approval data ठीक करें।
- Issue रहे तो admin audit log के लिए route, payload, screenshot और timestamp capture करें।


## Related Routes
- /engineering/artworks
- /engineering/cylinders
- /system/audit


## Screenshot References
- None

## FAQ References
- faq-access-control
- faq-data-refresh
