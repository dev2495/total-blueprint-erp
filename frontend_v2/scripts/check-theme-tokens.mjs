import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), "src");
const palette = "slate|blue|emerald|amber|rose|sky|cyan|teal|indigo|violet|fuchsia|pink|red|orange|yellow|green|zinc|neutral|stone";
const utilityPattern = new RegExp(String.raw`(?<![\\w-])(?:[a-z0-9_./()=\\[\\]:-]+:)*(?:bg|text|border|ring|from|via|to|shadow|divide|decoration|placeholder|caret|accent|outline|fill|stroke)-(?:${palette})-(?:50|100|200|300|400|500|600|700|800|900|950)(?:/[0-9]+)?(?![\\w-])`, "g");
const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;

const allowedUtilityPrefixes = [
  path.join("src", "components", "ui") + path.sep,
];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", "build"].includes(entry.name)) continue;
      files.push(...await walk(full));
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const findings = [];
for (const file of await walk(root)) {
  const rel = path.relative(process.cwd(), file);
  const text = await readFile(file, "utf8");
  const isAllowedUtilityFile = allowedUtilityPrefixes.some((prefix) => rel.startsWith(prefix));
  if (!isAllowedUtilityFile) {
    for (const match of text.matchAll(utilityPattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${rel}:${line} raw palette utility ${match[0]}`);
    }
  }
  if (rel.endsWith(".module.css")) {
    for (const match of text.matchAll(hexPattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${rel}:${line} raw hex in CSS module ${match[0]}`);
    }
  }
}

if (findings.length) {
  console.error(`Theme token guard failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  for (const finding of findings.slice(0, 200)) console.error(` - ${finding}`);
  if (findings.length > 200) console.error(` ... ${findings.length - 200} more`);
  process.exit(1);
}
console.log("Theme token guard passed");
