// Role → workspace check: every screen a role reaches in the old sidebar must still be
// reachable through a visible workspace (no lost screens, no new access).
import jitiFactory from "jiti";
const jiti = jitiFactory(new URL(import.meta.url).pathname, { alias: { "@": new URL("../src", import.meta.url).pathname }, interopDefault: true });
const nav = jiti("../src/lib/sidebar-nav.ts");
const ws = jiti("../src/lib/workspaces.ts");
const ROLES = ["ADMIN", "OWNER", "SUPER_ADMIN", "SALES", "PLANNER", "WORK_CENTER_MANAGER", "OPERATOR", "STORE", "DISPATCH", "ENGINEERING", "PLANT_MANAGER", "WATCHMAN", "MAINTENANCE_TECH", "MAINTENANCE_SUPERVISOR", "ACCOUNTS"];
let failed = 0;
for (const role of ROLES) {
  const ctx = { currentRoleCode: role, baseRoleCode: role, isOwner: role === "OWNER", isSuperuser: false, grantedPermissions: [] };
  const sidebar = [];
  for (const item of nav.NAV_ITEMS) {
    for (const child of item.children || []) if (nav.canAccessNavTarget(child, ctx)) sidebar.push(child.href);
    if (!item.children && nav.canAccessNavTarget(item, ctx)) sidebar.push(item.href);
  }
  const visible = ws.accessibleWorkspaces(ctx);
  const reachable = new Set(visible.flatMap((w) => w.tabs.map((t) => t.href)));
  const orphans = sidebar.filter((href) => !reachable.has(href) && !ws.resolveWorkspace(href));
  const hiddenWs = sidebar.filter((href) => { const r = ws.resolveWorkspace(href); return r && !visible.some((v) => v.workspace.key === r.workspace.key); });
  if (orphans.length || hiddenWs.length) failed++;
  console.log(`${role.padEnd(22)} workspaces: ${visible.map((v) => v.workspace.label).join(", ") || "(none)"} | old sidebar screens ${sidebar.length}${orphans.length ? ` | NOT IN ANY WORKSPACE: ${orphans.join(" ")}` : ""}${hiddenWs.length ? ` | IN HIDDEN WORKSPACE: ${hiddenWs.join(" ")}` : ""}`);
}
console.log(failed ? `FAILED for ${failed} role(s)` : "OK: every role's screens are reachable through its workspaces");
process.exit(failed ? 1 : 0);
