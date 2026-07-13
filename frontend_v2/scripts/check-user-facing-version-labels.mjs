import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["src/app", "src/components"];
const copyAttributes = new Set([
  "description",
  "eyebrow",
  "header",
  "hint",
  "label",
  "placeholder",
  "subtitle",
  "title",
]);
const failures = [];

function filesUnder(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) result.push(full);
  }
  return result;
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function record(sourceFile, node, text) {
  failures.push(`${sourceFile.fileName}:${lineOf(sourceFile, node)}: ${JSON.stringify(text)}`);
}

for (const file of roots.flatMap(filesUnder)) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      if (/\bversion\b/i.test(text)) record(sourceFile, node, text);

      const parent = node.parent;
      if (
        /\bv\d+(?:\.\d+)?\b/i.test(text) &&
        parent &&
        ts.isJsxAttribute(parent) &&
        copyAttributes.has(parent.name.getText(sourceFile))
      ) {
        record(sourceFile, node, text);
      }
    }

    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      if (/\bversion\b/i.test(text) || /\bv\d+(?:\.\d+)?\b/i.test(text)) {
        record(sourceFile, node, text);
      }
    }

    if (ts.isTemplateExpression(node)) {
      const text = node.getText(sourceFile);
      if (/\bv\s*\$\{[^}]*version/i.test(text)) record(sourceFile, node, text);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

const helpPagesPath = path.join("src", "help", "content", "pages", "pages.json");
const helpPages = JSON.parse(fs.readFileSync(helpPagesPath, "utf8"));

function scanLocalizedHelp(value, trace) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanLocalizedHelp(entry, `${trace}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  if (typeof value.en === "string" || typeof value.hi === "string") {
    for (const locale of ["en", "hi"]) {
      const copy = String(value[locale] || "");
      if (/\bversion\b/i.test(copy) || /\bv\d+(?:\.\d+)?\b/i.test(copy)) {
        failures.push(`${helpPagesPath}:${trace}.${locale}: ${JSON.stringify(copy)}`);
      }
    }
    return;
  }

  Object.entries(value).forEach(([key, entry]) => scanLocalizedHelp(entry, `${trace}.${key}`));
}

scanLocalizedHelp(helpPages, "PageGuides");

// Files in public/ are directly reachable without an application route. Keep
// technical revision labels out of those user-visible static assets as well.
const publicRoot = "public";
for (const file of filesUnder(publicRoot)) {
  const relative = path.relative(publicRoot, file);
  if (/\bv\d+(?:\.\d+)?\b/i.test(relative)) {
    failures.push(`${file}: versioned static asset name is user-reachable`);
  }

  if (/\.html$/i.test(file)) {
    const source = fs.readFileSync(file, "utf8");
    if (/\bversion\b/i.test(source) || /\bv\d+(?:\.\d+)?\b/i.test(source)) {
      failures.push(`${file}: user-reachable static HTML contains a technical version label`);
    }
  }
}

if (failures.length) {
  console.error("User-facing technical version labels are forbidden:\n" + failures.join("\n"));
  process.exit(1);
}

console.log("User-facing version privacy check passed.");
