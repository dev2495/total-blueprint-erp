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
const rollScreens = ["inventory-rolls-v36-overview", "inventory-rolls-v36-workflow"];

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
    relatedRoutes: ["/inventory", "/inventory/grn-v36", "/inventory/period", "/inventory/traceability-v36"],
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
    ["inventory-rolls-v36-overview", "inventory-stock-lifecycle-workflow"],
  )],
  ["/inventory/grn-v36", guide(
    "/inventory/grn-v36",
    "Smart GRN",
    "Inventory",
    "Smart GRN receives bulk, rolls, packaging, POD, and purchased add-ons through one adaptive inward page.",
    "Use material-type chips first, then select material, quantity, UOM, warehouse, optional vendor references, and only expand QC details when required.",
    grnScreens,
  )],
  ["/inventory/period", guide(
    "/inventory/period",
    "Period & Audit",
    "Inventory",
    "Period & Audit is the single stock lifecycle workspace for opening balance, count, variance, post, close, and closed-FY correction.",
    "Use this page for stock count and period control. It writes real audit lines and stock-card corrections instead of keeping a parallel old lifecycle.",
    stockScreens,
    "stock-lifecycle-flow",
  )],
  ["/inventory/count", guide(
    "/inventory/count",
    "Mobile Stock Count",
    "Inventory",
    "Mobile Stock Count is the floor-friendly count entry surface connected to Period & Audit batches.",
    "Open a batch from Period & Audit, then count by location/material/roll with mobile-friendly controls.",
    stockScreens,
    "stock-lifecycle-flow",
    ["ADMIN", "OWNER", "STORE", "WORK_CENTER_MANAGER"],
  )],
  ["/inventory/bulk-v36", guide(
    "/inventory/bulk-v36",
    "Bulk Workspace",
    "Inventory",
    "Bulk Workspace shows granules, inks, adhesives, solvents, chemicals, POD, and purchased add-on bulk stock by class, plant, location, and health.",
    "Use it to review current bulk availability and open Smart GRN for inward; stock-changing actions still go through GRN, lifecycle, or approved consumption.",
    bulkScreens,
  )],
  ["/inventory/addons-v36", guide(
    "/inventory/addons-v36",
    "Inks & Adhesives Workspace",
    "Inventory",
    "Inks & Adhesives Workspace groups color-bearing inks, adhesives, solvents, and purchased add-ons with inventory and master context.",
    "Use it to inspect available stock and verify color/add-on masters before order, artwork, GRN, or packing selection.",
    ["inventory-addons-overview", "inventory-addons-workflow"],
  )],
  ["/inventory/packaging-v36", guide(
    "/inventory/packaging-v36",
    "Packaging Workspace",
    "Inventory",
    "Packaging Workspace tracks inner pouches, gonny, sheets, tape, labels, cartons, and POD-style packing materials.",
    "Use it to verify stock and supply mode. Inner pouch and gonny can be auto-consumed by packing logic while other allowed packing SKUs are counted or issued through the packing flow.",
    packagingScreens,
  )],
  ["/inventory/rolls-v36", guide(
    "/inventory/rolls-v36",
    "Rolls Workspace",
    "Inventory",
    "Rolls Workspace shows available, reserved, WIP, and finished rolls by product signature, width, thickness, age, and location.",
    "Use it to inspect roll stock, match WIP/final rolls, and drill into traceability before dispatch or planner allocation.",
    rollScreens,
  )],
  ["/inventory/grn-history-v36", guide(
    "/inventory/grn-history-v36",
    "GRN History",
    "Inventory",
    "GRN History reviews posted inward entries and controlled corrections.",
    "Use it for audit review and correction with reason; use Smart GRN for new inward.",
    grnScreens,
  )],
  ["/inventory/traceability-v36", guide(
    "/inventory/traceability-v36",
    "Roll Genealogy & Stock Card",
    "Inventory",
    "Roll Genealogy and Stock Card show movement lineage, stock balances, source links, and audit history.",
    "Use this page to verify that inward, production, packing, dispatch, and correction entries landed in the stock card.",
    ["inventory-traceability-overview", "inventory-traceability-workflow"],
  )],
  ["/inventory/inter-plant-v36", guide(
    "/inventory/inter-plant-v36",
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

for (const [route, nextGuide] of replacements) {
  upsert(route, nextGuide);
}

fs.writeFileSync(pagesPath, `${JSON.stringify(pages, null, 2)}\n`, "utf8");
console.log(`Refreshed ${replacements.size} current help page guide(s).`);
