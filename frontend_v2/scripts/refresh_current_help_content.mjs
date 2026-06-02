import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const pagesPath = path.join(appRoot, "src", "help", "content", "pages", "pages.json");
const pages = JSON.parse(fs.readFileSync(pagesPath, "utf8"));

const t = (en, hi = en) => ({ en, hi });
const stockScreens = ["inventory-stock-lifecycle-overview", "inventory-stock-lifecycle-workflow"];
const grnScreens = ["inventory-grn-overview", "inventory-grn-workflow"];
const bulkScreens = ["inventory-bulk-overview", "inventory-bulk-workflow"];
const packagingScreens = ["inventory-packaging-overview", "inventory-packaging-workflow"];
const rollScreens = ["inventory-rolls-overview", "inventory-rolls-workflow"];

function guide(route, title, module, summary, purpose, screenshots, flow = "inventory-action-flow", roles = ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"]) {
  return {
    routePattern: route,
    title: t(title),
    module,
    roles,
    summary: t(summary),
    purpose: t(purpose),
    prerequisites: [
      t("Confirm the correct plant, role, period, and source record before posting."),
      t("Use the current V36 workspace route for new work."),
      t("Review visible validation errors before submit and keep source proof ready for audit."),
    ],
    keyActions: [
      t("Open the current workspace and check the summary, filters, and selected context."),
      t("Pick records from searchable selectors instead of typing stale codes wherever the UI provides a picker."),
      t("Submit, confirm the toast/result, then re-open the linked stock card, order, or audit trail."),
    ],
    fieldHelp: [
      { field: t("Context"), help: t("Plant, warehouse, stock class, route, and role decide which records and actions are valid.") },
      { field: t("Quantity"), help: t("Use the UOM shown by the selected material. Rolls use gross/tare/net where applicable; bulk and packaging use their master UOM.") },
      { field: t("Audit note"), help: t("Write the reason when a transaction changes stock, closes a period, or corrects a posted record.") },
    ],
    decisionFlowId: flow,
    commonErrors: [
      { error: t("No selectable item"), reason: t("The selected filter, plant, or material class does not match active stock or master data.") },
      { error: t("Validation failed"), reason: t("A required source, quantity, location, UOM, or approval step is missing.") },
      { error: t("Action hidden"), reason: t("Role permissions, period status, or route state blocks the next step.") },
    ],
    recoverySteps: [
      t("Refresh the page and reselect plant, warehouse, and class filters."),
      t("Use the inline help flow and field help to confirm the expected action."),
      t("If still blocked, capture route, payload context, screenshot, and timestamp for admin review."),
    ],
    relatedRoutes: ["/inventory", "/inventory/grn", "/inventory/stock-lifecycle", "/inventory/traceability"],
    screenshotKeys: screenshots,
    faqRefs: ["faq-access-control", "faq-data-refresh"],
  };
}

const replacements = new Map([
  ["/inventory", guide(
    "/inventory",
    "Inventory Workspace",
    "Inventory",
    "Inventory Workspace is the current summary launcher for rolls, bulk, packaging, GRN, lifecycle, traceability, and inter-plant work.",
    "Use this page first to understand stock health, then open the exact workspace from the Inventory surface instead of using old scattered pages.",
    ["inventory-rolls-overview", "inventory-stock-lifecycle-workflow"],
  )],
  ["/inventory/grn", guide(
    "/inventory/grn",
    "Smart GRN",
    "Inventory",
    "Smart GRN receives bulk, rolls, packaging, POD, and purchased add-ons through one adaptive inward page.",
    "Use material-type chips first, then select material, quantity, UOM, warehouse, optional vendor references, and only expand QC details when required.",
    grnScreens,
  )],
  ["/inventory/bulk", guide(
    "/inventory/bulk",
    "Bulk Workspace",
    "Inventory",
    "Bulk Workspace shows granules, inks, adhesives, solvents, chemicals, POD, and purchased add-on bulk stock by class, plant, location, and health.",
    "Use it to review current bulk availability and open Smart GRN for inward; stock-changing actions still go through GRN, lifecycle, or approved consumption.",
    bulkScreens,
  )],
  ["/inventory/addons", guide(
    "/inventory/addons",
    "Inks & Adhesives Workspace",
    "Inventory",
    "Inks & Adhesives Workspace groups color-bearing inks, adhesives, solvents, and purchased add-ons with inventory and master context.",
    "Use it to inspect available stock and verify color/add-on masters before order, artwork, GRN, or packing selection.",
    ["inventory-addons-overview", "inventory-addons-workflow"],
  )],
  ["/inventory/packaging", guide(
    "/inventory/packaging",
    "Packaging Workspace",
    "Inventory",
    "Packaging Workspace tracks inner pouches, gonny, sheets, tape, labels, cartons, and POD-style packing materials.",
    "Use it to verify stock and supply mode. Inner pouch and gonny can be auto-consumed by packing logic while other allowed packing SKUs are counted or issued through the packing flow.",
    packagingScreens,
  )],
  ["/inventory/rolls", guide(
    "/inventory/rolls",
    "Rolls Workspace",
    "Inventory",
    "Rolls Workspace shows available, reserved, WIP, and finished rolls by product signature, width, thickness, age, and location.",
    "Use it to inspect roll stock, match WIP/final rolls, and drill into traceability before dispatch or planner allocation.",
    rollScreens,
  )],
  ["/inventory/grn-history", guide(
    "/inventory/grn-history",
    "GRN History",
    "Inventory",
    "GRN History reviews posted inward entries and controlled corrections.",
    "Use it for audit review and correction with reason; use Smart GRN for new inward.",
    grnScreens,
  )],
  ["/inventory/traceability", guide(
    "/inventory/traceability",
    "Roll Genealogy & Stock Card",
    "Inventory",
    "Roll Genealogy and Stock Card show movement lineage, stock balances, source links, and audit history.",
    "Use this page to verify that inward, production, packing, dispatch, and correction entries landed in the stock card.",
    ["inventory-traceability-overview", "inventory-traceability-workflow"],
  )],
  ["/inventory/inter-plant", guide(
    "/inventory/inter-plant",
    "Inter-Plant",
    "Inventory",
    "Inter-Plant moves rolls and bulk stock between plants using dispatch, transit, receive, and audit status.",
    "Use source/destination plant filters, select eligible stock, dispatch to transit, then receive into the destination warehouse.",
    ["inventory-inter-plant-overview", "inventory-inter-plant-workflow"],
  )],
  ["/logistics/packing", guide(
    "/logistics/packing",
    "Packing Yard",
    "Logistics",
    "Packing Yard packs roll and pouch orders, records gonny sealing, and posts allowed packing material consumption.",
    "Use allowed packing items from the sales/product setup. Inner pouch is math-driven, gonny is counted by sealed bags, and evening packing-material counts can reconcile remaining consumables.",
    ["logistics-packing-overview", "logistics-packing-workflow"],
    "dispatch-flow",
    ["ADMIN", "OWNER", "STORE", "DISPATCH", "PLANT_MANAGER"],
  )],
  ["/logistics/packing/consumption", guide(
    "/logistics/packing/consumption",
    "Packing Material Count",
    "Logistics",
    "Packing Material Count records evening stock snapshots for packing materials so consumption can be reconciled against orders packed that day.",
    "Use this when exact per-order tape/sheet/label issue is hard. Count closing stock, then let the system allocate usage across the packed order set.",
    ["logistics-packing-overview", "logistics-packing-workflow"],
    "dispatch-flow",
    ["ADMIN", "OWNER", "STORE", "DISPATCH", "PLANT_MANAGER"],
  )],
  ["/sales/orders/create", guide(
    "/sales/orders/create",
    "Sales Order Create",
    "Sales",
    "Sales Order Create is the fast product-master order entry flow for direct sales, artwork orders, and planner demand creation.",
    "Select customer, product master, axes, artwork, packing options, and dispatch terms; BOM and planner demand are derived from the product-master model.",
    ["sales-orders-create-overview", "sales-orders-create-workflow"],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES", "PLANNER"],
  )],
  ["/production/planner", guide(
    "/production/planner",
    "Planner Control Tower",
    "Production",
    "Planner Control Tower is the current release surface for Direct FG, Match WIP, Fresh production, and stock launcher flows.",
    "Use it to convert demand into real releases while preserving product-master axis, artwork, stock, and route truth.",
    ["production-planner-overview", "production-planner-workflow"],
    "production-execution-flow",
    ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER"],
  )],
  ["/master/products", guide(
    "/master/products",
    "Product Masters",
    "Master",
    "Product Masters define base product logic, axes, geometry, layers, templates, packing allowances, and variant derivation.",
    "Use this as the source of truth for pouch, roll, generic stock, artwork, and planner flows. Variant SKU data should be derived from master axes, not maintained as a parallel model.",
    ["master-overview", "master-workflow"],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES", "PLANNER", "ENGINEERING"],
  )],
  ["/analytics/reports/trading", guide(
    "/analytics/reports/trading",
    "Trading Report",
    "Analytics",
    "Trading Report summarizes trading stock, dispatch, and commercial movement from report data.",
    "Use filters to review trading activity, then export or drill into the source records behind each row.",
    [],
    "dashboard-decision-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/dashboard/planner/control-tower/gang-builder", guide(
    "/dashboard/planner/control-tower/gang-builder",
    "Planner Gang Builder",
    "Planner",
    "Planner Gang Builder groups compatible demand for batch planning from the control tower.",
    "Use it to review compatible orders, confirm grouping rules, and release only validated planning groups.",
    [],
    "production-execution-flow",
    ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER"],
  )],
  ["/production/planner/gang-builder", guide(
    "/production/planner/gang-builder",
    "Production Gang Builder",
    "Production",
    "Production Gang Builder groups compatible demand for planner release from the production route.",
    "Use it to combine compatible demand without bypassing product-master, artwork, or stock checks.",
    [],
    "production-execution-flow",
    ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER"],
  )],
  ["/inventory/adjustments", guide(
    "/inventory/adjustments",
    "Inventory Adjustments",
    "Inventory",
    "Inventory Adjustments lists controlled stock corrections and approval status.",
    "Use this page to find, review, and audit adjustment requests before posting stock impact.",
    [],
  )],
  ["/inventory/adjustments/new", guide(
    "/inventory/adjustments/new",
    "New Inventory Adjustment",
    "Inventory",
    "New Inventory Adjustment creates a controlled stock correction with reason and source context.",
    "Select the exact material, location, quantity, and reason so finance and inventory can audit the correction.",
    [],
  )],
  ["/inventory/adjustments/[id]", guide(
    "/inventory/adjustments/[id]",
    "Inventory Adjustment Detail",
    "Inventory",
    "Inventory Adjustment Detail shows posted correction context, audit notes, and stock impact.",
    "Review approval state, quantity, material, location, and audit trail before further action.",
    [],
  )],
  ["/inventory/stock-lifecycle", guide(
    "/inventory/stock-lifecycle",
    "Stock Lifecycle",
    "Inventory",
    "Stock Lifecycle is the canonical cockpit for stock value analytics, opening stock, physical count, monthly tally tracking, and financial-year close.",
    "Use this page for all stock lifecycle work. Closed financial years are immutable; stock adjustments belong only in an open financial year.",
    stockScreens,
    "stock-lifecycle-flow",
  )],
  ["/inventory/period", guide(
    "/inventory/period",
    "Stock Lifecycle Close Redirect",
    "Inventory",
    "This retired period route redirects to the canonical Stock Lifecycle cockpit.",
    "Use /inventory/stock-lifecycle for period close work; this guide exists only for old bookmarks and redirected links.",
    stockScreens,
    "stock-lifecycle-flow",
  )],
  ["/inventory/count", guide(
    "/inventory/count",
    "Stock Lifecycle Count Redirect",
    "Inventory",
    "This retired count route redirects to the canonical Stock Lifecycle cockpit.",
    "Use /inventory/stock-lifecycle for physical count work; this guide exists only for old bookmarks and redirected links.",
    stockScreens,
    "stock-lifecycle-flow",
    ["ADMIN", "OWNER", "STORE", "WORK_CENTER_MANAGER"],
  )],
  ["/logistics/packing/audit", guide(
    "/logistics/packing/audit",
    "Packing Audit",
    "Logistics",
    "Packing Audit reviews packed units, material consumption, and dispatch readiness evidence.",
    "Use this page to inspect packing proof before dispatch, POD follow-up, or stock reconciliation.",
    [],
    "dispatch-flow",
    ["ADMIN", "OWNER", "STORE", "DISPATCH", "PLANT_MANAGER"],
  )],
  ["/master/pouch-styles", guide(
    "/master/pouch-styles",
    "Pouch Styles",
    "Master",
    "Pouch Styles maintains pouch construction choices used by sales, product master, and packing.",
    "Use it to review active pouch styles before assigning them to products or order variants.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES", "PLANNER", "ENGINEERING"],
  )],
  ["/master/pouch-styles/new", guide(
    "/master/pouch-styles/new",
    "New Pouch Style",
    "Master",
    "New Pouch Style creates a controlled pouch-style master record.",
    "Define naming, active status, and operational notes before using the style in product setup.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES", "PLANNER", "ENGINEERING"],
  )],
  ["/master/pouch-styles/[id]", guide(
    "/master/pouch-styles/[id]",
    "Pouch Style Detail",
    "Master",
    "Pouch Style Detail edits one pouch-style master record.",
    "Review dependent product/order usage before changing a style already used in production.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES", "PLANNER", "ENGINEERING"],
  )],
  ["/master/trading-goods", guide(
    "/master/trading-goods",
    "Trading Goods",
    "Master",
    "Trading Goods maintains bought-and-sold item masters used by sales and reporting.",
    "Use it to keep trading SKUs, HSN, UOM, and active status aligned before order entry.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/master/trading-goods/new", guide(
    "/master/trading-goods/new",
    "New Trading Good",
    "Master",
    "New Trading Good creates a trading item master for direct commercial use.",
    "Enter code, item identity, UOM, and tax context before using the SKU in trade orders.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/master/trading-goods/[id]", guide(
    "/master/trading-goods/[id]",
    "Trading Good Detail",
    "Master",
    "Trading Good Detail edits an existing trading item master.",
    "Check open orders and reports before changing a trading SKU that is already in use.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/master/web-width-policies", guide(
    "/master/web-width-policies",
    "Web Width Policies",
    "Master",
    "Web Width Policies define allowed parent/child web-width planning rules.",
    "Use this master to keep planning width checks explicit instead of relying on manual assumptions.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "PLANNER", "ENGINEERING"],
  )],
  ["/master/web-width-policies/new", guide(
    "/master/web-width-policies/new",
    "New Web Width Policy",
    "Master",
    "New Web Width Policy creates a validated width-planning rule.",
    "Enter the parent width, child width, tolerance, and active status before planner use.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "PLANNER", "ENGINEERING"],
  )],
  ["/master/web-width-policies/[id]", guide(
    "/master/web-width-policies/[id]",
    "Web Width Policy Detail",
    "Master",
    "Web Width Policy Detail edits one web-width planning rule.",
    "Review planning impact before changing a policy already used by active demand.",
    [],
    "master-data-flow",
    ["ADMIN", "OWNER", "PLANNER", "ENGINEERING"],
  )],
  ["/sales/trade-orders", guide(
    "/sales/trade-orders",
    "Trade Orders",
    "Sales",
    "Trade Orders lists direct trading sales orders and their current commercial status.",
    "Use this page to track trade demand, open order detail, or create a new trade order.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/sales/trade-orders/new", guide(
    "/sales/trade-orders/new",
    "New Trade Order",
    "Sales",
    "New Trade Order creates a direct trading order from trading goods masters.",
    "Select customer, trading SKU, quantity, commercial terms, and dispatch expectation before saving.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/sales/trade-orders/[id]", guide(
    "/sales/trade-orders/[id]",
    "Trade Order Detail",
    "Sales",
    "Trade Order Detail shows one trade order, line items, status, and downstream actions.",
    "Review customer, SKU, quantity, dispatch, and audit status before editing or closing.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/sales/trade-orders/[id]/edit", guide(
    "/sales/trade-orders/[id]/edit",
    "Edit Trade Order",
    "Sales",
    "Edit Trade Order updates a direct trading order before final downstream lock.",
    "Change only confirmed commercial details and re-check dispatch or reporting impact after save.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/procurement/purchase-orders", guide(
    "/procurement/purchase-orders",
    "Purchase Orders",
    "Procurement",
    "Purchase Orders lists procurement demand, vendor commitments, and receipt progress.",
    "Use this page to review open purchase orders before receiving material through the controlled GRN flow.",
    [],
    "inventory-action-flow",
    ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
  )],
  ["/procurement/purchase-orders/new", guide(
    "/procurement/purchase-orders/new",
    "New Purchase Order",
    "Procurement",
    "New Purchase Order creates a vendor commitment for material replenishment.",
    "Select vendor, material, quantity, expected date, and plant context before saving the order.",
    [],
    "inventory-action-flow",
    ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
  )],
  ["/procurement/purchase-orders/[id]", guide(
    "/procurement/purchase-orders/[id]",
    "Purchase Order Detail",
    "Procurement",
    "Purchase Order Detail shows order lines, receipt status, and audit context.",
    "Use this page to verify ordered quantity, pending receipt, and source documents before GRN.",
    [],
    "inventory-action-flow",
    ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
  )],
  ["/procurement/purchase-orders/[id]/receive", guide(
    "/procurement/purchase-orders/[id]/receive",
    "Receive Purchase Order",
    "Procurement",
    "Receive Purchase Order records controlled receipt against an existing purchase order.",
    "Confirm plant, warehouse, received quantity, vendor document, and inspection context before posting stock.",
    [],
    "inventory-action-flow",
    ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
  )],
  ["/sales/orders/[id]/dispatches", guide(
    "/sales/orders/[id]/dispatches",
    "Sales Order Dispatches",
    "Sales",
    "Sales Order Dispatches lists dispatch records connected to one sales order.",
    "Use this page to verify challan, packed quantity, and dispatch status before customer follow-up.",
    [],
    "dispatch-flow",
    ["ADMIN", "OWNER", "SALES", "DISPATCH"],
  )],
  ["/sales/orders/[id]/dispatches/new", guide(
    "/sales/orders/[id]/dispatches/new",
    "New Sales Dispatch",
    "Sales",
    "New Sales Dispatch creates a dispatch record for a sales order.",
    "Confirm packed stock, customer destination, challan context, and quantity before dispatching.",
    [],
    "dispatch-flow",
    ["ADMIN", "OWNER", "SALES", "DISPATCH"],
  )],
  ["/sales/quotations/new", guide(
    "/sales/quotations/new",
    "New Quotation",
    "Sales",
    "New Quotation creates a commercial offer from customer and product context.",
    "Select customer, item, quantity, pricing, tax, and validity before converting to an order.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/sales/quotations/[id]", guide(
    "/sales/quotations/[id]",
    "Quotation Detail",
    "Sales",
    "Quotation Detail shows one offer, revision context, and conversion status.",
    "Review customer terms, quoted lines, validity, and downstream order status before editing or converting.",
    [],
    "sales-order-flow",
    ["ADMIN", "OWNER", "SALES"],
  )],
  ["/system/company-profile", guide(
    "/system/company-profile",
    "Company Profile",
    "System",
    "Company Profile stores legal and operational company identity used in documents.",
    "Keep company name, address, tax identifiers, and document defaults current before issuing external documents.",
    [],
    "system-governance-flow",
    ["ADMIN", "OWNER", "SUPER_ADMIN"],
  )],
  ["/system/reason-codes", guide(
    "/system/reason-codes",
    "Reason Codes",
    "System",
    "Reason Codes maintain controlled explanations used by inventory, dispatch, and operational corrections.",
    "Use active, specific reason codes so audit trails are searchable and consistent.",
    [],
    "system-governance-flow",
    ["ADMIN", "OWNER", "SUPER_ADMIN"],
  )],
  ["/system/reorder-policy", guide(
    "/system/reorder-policy",
    "Reorder Policy",
    "System",
    "Reorder Policy maintains stock thresholds and replenishment settings.",
    "Review material, plant, minimum stock, safety stock, and lead-time context before enabling alerts.",
    [],
    "system-governance-flow",
    ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
  )],
  ["/system/users/new", guide(
    "/system/users/new",
    "New User",
    "System",
    "New User creates a controlled login with role, permissions, and operational context.",
    "Assign the correct role and context before activating the account so route visibility stays governed.",
    [],
    "system-governance-flow",
    ["ADMIN", "OWNER", "SUPER_ADMIN"],
  )],
]);

function upsert(route, nextGuide) {
  const indexes = pages
    .map((page, index) => page.routePattern === route ? index : -1)
    .filter((index) => index >= 0);

  if (!indexes.length) {
    pages.push(nextGuide);
    return;
  }

  for (const index of indexes) {
    pages[index] = {
      ...pages[index],
      ...nextGuide,
    };
  }
}

const retiredRoutes = new Set(["/inventory/period", "/inventory/count"]);
const obsoleteGuideRoutes = new Set([
  "/inventory/addons-v36",
  "/inventory/bulk-v36",
  "/inventory/grn-history-v36",
  "/inventory/grn-v36",
  "/inventory/inter-plant-v36",
  "/inventory/packaging-v36",
  "/inventory/rolls-v36",
  "/inventory/traceability-v36",
]);

for (let index = pages.length - 1; index >= 0; index -= 1) {
  if (obsoleteGuideRoutes.has(pages[index]?.routePattern)) {
    pages.splice(index, 1);
  }
}

for (const [route, nextGuide] of replacements) {
  upsert(route, nextGuide);
}

function scrubRetiredRoutes(value, propertyName = "") {
  if (Array.isArray(value)) {
    const seen = new Set();
    return value
      .map((entry) => scrubRetiredRoutes(entry))
      .filter((entry) => {
        const key = typeof entry === "string" ? entry : JSON.stringify(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      value[key] = scrubRetiredRoutes(entry, key);
    }
    return value;
  }
  if (propertyName !== "routePattern" && retiredRoutes.has(value)) return "/inventory/stock-lifecycle";
  return value;
}

for (const page of pages) {
  scrubRetiredRoutes(page);
}

const seenGuideRoutes = new Set();
for (let index = pages.length - 1; index >= 0; index -= 1) {
  const routePattern = pages[index]?.routePattern;
  if (!routePattern) continue;
  if (seenGuideRoutes.has(routePattern)) {
    pages.splice(index, 1);
  } else {
    seenGuideRoutes.add(routePattern);
  }
}

fs.writeFileSync(pagesPath, `${JSON.stringify(pages, null, 2)}\n`, "utf8");
console.log(`Refreshed ${replacements.size} current help page guide(s).`);
