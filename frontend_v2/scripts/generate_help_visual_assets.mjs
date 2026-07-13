import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, "..");
const screenshotDir = path.join(appRoot, "public", "help", "screenshots");

const pages = JSON.parse(fs.readFileSync(path.join(appRoot, "src", "help", "content", "pages", "pages.json"), "utf8"));
const flows = JSON.parse(fs.readFileSync(path.join(appRoot, "src", "help", "content", "flows", "flows.json"), "utf8"));
const flowById = new Map(flows.map((flow) => [flow.id, flow]));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function text(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.en || "";
}

function wrap(value, max = 34) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function nodeCard(node, index, x, y, width, height) {
  const titleLines = wrap(text(node.title), 28);
  const outcomes = (node.outcomes || []).slice(0, 3).map((outcome) => text(outcome.label));
  const titleSvg = titleLines.map((line, i) => `<text x="${x + 62}" y="${y + 42 + i * 24}" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#0f172a">${esc(line)}</text>`).join("");
  const outcomeSvg = outcomes.map((line, i) => `<text x="${x + 26}" y="${y + 126 + i * 26}" font-family="Arial, sans-serif" font-size="16" font-weight="600" fill="#475569">- ${esc(line)}</text>`).join("");
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
    <rect x="${x + 20}" y="${y + 22}" width="34" height="34" rx="10" fill="#2563eb"/>
    <text x="${x + 37}" y="${y + 45}" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="800" fill="#ffffff">${index + 1}</text>
    ${titleSvg}
    <line x1="${x + 24}" y1="${y + 94}" x2="${x + width - 24}" y2="${y + 94}" stroke="#e2e8f0" stroke-width="2"/>
    ${outcomeSvg}
  `;
}

function arrow(x1, y1, x2, y2) {
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#334155" stroke-width="4" stroke-linecap="round"/>
    <path d="M ${x2 - 12} ${y2 - 8} L ${x2} ${y2} L ${x2 - 12} ${y2 + 8}" fill="none" stroke="#334155" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  `;
}

function renderFlowSvg(page, flow) {
  const nodes = (flow?.nodes || []).slice(0, 6);
  const cardWidth = 330;
  const cardHeight = 210;
  const gapX = 56;
  const gapY = 46;
  const startX = 78;
  const startY = 188;
  const width = 1280;
  const height = 760;
  const title = text(page.title);
  const flowTitle = text(flow?.title) || "Workflow";

  const cards = nodes.map((node, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    return nodeCard(node, index, startX + col * (cardWidth + gapX), startY + row * (cardHeight + gapY), cardWidth, cardHeight);
  }).join("");

  const arrows = nodes.slice(0, -1).map((_, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const nextCol = (index + 1) % 3;
    const nextRow = Math.floor((index + 1) / 3);
    if (nextRow === row) {
      const y = startY + row * (cardHeight + gapY) + cardHeight / 2;
      const x1 = startX + col * (cardWidth + gapX) + cardWidth + 8;
      const x2 = startX + nextCol * (cardWidth + gapX) - 14;
      return arrow(x1, y, x2, y);
    }
    const x = startX + col * (cardWidth + gapX) + cardWidth / 2;
    const y1 = startY + row * (cardHeight + gapY) + cardHeight + 8;
    const y2 = startY + nextRow * (cardHeight + gapY) - 14;
    return arrow(x, y1, x, y2);
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)} workflow">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#eef6ff"/>
      <stop offset="52%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#ecfdf5"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="48" y="48" width="${width - 96}" height="96" rx="24" fill="#0f172a"/>
  <text x="84" y="96" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#ffffff">${esc(title)}</text>
  <text x="84" y="126" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#bfdbfe">${esc(flowTitle)}</text>
  ${arrows}
  ${cards}
</svg>
`;
}

ensureDir(screenshotDir);
let written = 0;
for (const page of pages) {
  const flow = flowById.get(page.decisionFlowId);
  for (const key of page.screenshotKeys || []) {
    if (!key.includes("workflow")) continue;
    const svg = renderFlowSvg(page, flow).replace(/[ \t]+$/gm, "");
    fs.writeFileSync(path.join(screenshotDir, `${key}.svg`), svg, "utf8");
    written += 1;
  }
}

console.log(`Generated ${written} help workflow SVG asset(s).`);
