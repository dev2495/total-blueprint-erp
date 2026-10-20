// Role → pages matrix with each role's real permissions (from the backend role matrix).
// Usage: node scripts/role-page-matrix.mjs <role-perms.json>
import fs from "node:fs";
import jitiFactory from "jiti";
const jiti = jitiFactory(new URL(import.meta.url).pathname, { alias: { "@": new URL("../src", import.meta.url).pathname }, interopDefault: true });
const nav = jiti("../src/lib/sidebar-nav.ts");
const ws = jiti("../src/lib/workspaces.ts");
const perms = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const [role, granted] of Object.entries(perms)) {
  const ctx = { currentRoleCode: role, baseRoleCode: role, isOwner: role === "OWNER", isSuperuser: false, grantedPermissions: granted };
  const pages = [];
  for (const item of nav.NAV_ITEMS) {
    for (const child of item.children || []) if (nav.canAccessNavTarget(child, ctx)) pages.push(child.href);
    if (!item.children && nav.canAccessNavTarget(item, ctx)) pages.push(item.href);
  }
  const visible = ws.accessibleWorkspaces(ctx).map((v) => v.workspace.label);
  console.log(`\n${role} (${granted.length} perms) workspaces: ${visible.join(", ")}`);
  const byTop = {};
  for (const p of [...new Set(pages)].sort()) (byTop[p.split("/")[1]] ||= []).push(p);
  for (const [top, list] of Object.entries(byTop)) console.log(`  /${top}: ${list.map((p) => p.replace(`/${top}`, "") || "/").join(" ")}`);
}
