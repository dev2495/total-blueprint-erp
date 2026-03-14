const fs = require("fs");
const path = require("path");

const distDir = path.resolve(__dirname, "..", ".next");
const manifestPath = path.join(distDir, "app-build-manifest.json");
const buildManifestPath = path.join(distDir, "build-manifest.json");

if (!fs.existsSync(manifestPath)) {
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pages = manifest.pages || {};
const buildManifest = fs.existsSync(buildManifestPath)
  ? JSON.parse(fs.readFileSync(buildManifestPath, "utf8"))
  : null;

const serverRoot = path.join(distDir, "server", "app");
fs.mkdirSync(serverRoot, { recursive: true });

for (const pageKey of Object.keys(pages)) {
  const normalized = pageKey.replace(/^\//, "");
  const targetDir = path.join(serverRoot, normalized);
  fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "app-build-manifest.json");
  fs.writeFileSync(targetFile, JSON.stringify(manifest));
  if (buildManifest) {
    const buildTarget = path.join(targetDir, "build-manifest.json");
    fs.writeFileSync(buildTarget, JSON.stringify(buildManifest));
  }
}
