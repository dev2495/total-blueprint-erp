#!/usr/bin/env node

const raw = process.versions.node || "";
const major = Number.parseInt(raw.split(".")[0] || "", 10);

if (!Number.isInteger(major) || major < 18 || major > 20) {
  console.error(
    `Unsupported Node.js version ${raw}. Use Node 18 or 20 for stable Next.js runtime in this ERP.`
  );
  process.exit(1);
}
