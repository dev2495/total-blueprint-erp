import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const frontendRoot = process.cwd()
const repoRoot = path.resolve(frontendRoot, "..")
const runtimeRoot = path.join(repoRoot, ".runtime", "ui-e2e")
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm"
const runTag = process.env.UI_E2E_RUN_TAG || new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)
const dbName = process.env.POSTGRES_DB || process.env.DB_NAME || "total_blueprint_erp"

function resolvePython() {
  const isHealthy = (candidate) => {
    if (!candidate || !fs.existsSync(String(candidate))) return false
    const probe = spawnSync(
      String(candidate),
      [
        "-c",
        [
          "import importlib.util, sys",
          "mods=['django','reportlab','whitenoise']",
          "missing=[m for m in mods if importlib.util.find_spec(m) is None]",
          "sys.exit(1 if missing else 0)",
        ].join("; "),
      ],
      {
        cwd: repoRoot,
        stdio: "ignore",
        env: process.env,
      },
    )
    return probe.status === 0
  }

  const candidates = [
    process.env.UI_E2E_PYTHON,
    process.env.BACKEND_PYTHON,
    path.join(repoRoot, "venv_311", "bin", "python"),
    path.join(repoRoot, ".venv-validate", "bin", "python"),
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (isHealthy(String(candidate))) return String(candidate)
  }

  throw new Error("No healthy backend Python runtime found for release-green runner.")
}

function runOrThrow(cmd, args, extraEnv = {}, cwd = repoRoot) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`)
  }
}

function readStdoutOrThrow(cmd, args, extraEnv = {}, cwd = repoRoot) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  })
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}`)
  }
  return String(result.stdout || "")
}

function writeRunMetadata() {
  const payload = {
    run_tag: runTag,
    label_prefix: "UAT-GREEN",
    generated_at: new Date().toISOString(),
  }
  fs.writeFileSync(path.join(runtimeRoot, "green-run.json"), JSON.stringify(payload, null, 2))
}

function assertNoProtectedDuplicateFiles() {
  const protectedRoots = [
    path.join(frontendRoot, "src", "app"),
    path.join(frontendRoot, "src", "components"),
    path.join(frontendRoot, "src", "services"),
    path.join(frontendRoot, "src", "lib"),
    path.join(repoRoot, "apps"),
    path.join(repoRoot, "config"),
  ]
  const offenders = []

  const walk = (current) => {
    if (!fs.existsSync(current)) return
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (/ [23]\.[^.]+$/.test(entry.name)) {
        offenders.push(path.relative(repoRoot, fullPath))
      }
    }
  }

  for (const root of protectedRoots) {
    walk(root)
  }

  if (offenders.length) {
    throw new Error(`Protected duplicate files still exist:\n${offenders.join("\n")}`)
  }
}

function commandExists(command) {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    cwd: repoRoot,
    stdio: "ignore",
    env: process.env,
  })
  return result.status === 0
}

function trimIdleDbConnections(extraEnv = {}) {
  if (!commandExists("psql")) return

  const env = { ...process.env, ...extraEnv }
  const terminateSql = [
    "SELECT pg_terminate_backend(pid)",
    "FROM pg_stat_activity",
    `WHERE datname = '${dbName.replace(/'/g, "''")}'`,
    "AND pid <> pg_backend_pid()",
    "AND state = 'idle';",
  ].join(" ")

  spawnSync("psql", ["-d", dbName, "-c", terminateSql], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  })
}

const pythonBin = resolvePython()
const strictEnv = {
  SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
  SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
  DB_CONN_MAX_AGE: process.env.DB_CONN_MAX_AGE || "0",
  UI_E2E_REQUIRE_SCHEMA: "1",
  UI_E2E_ALLOW_SCHEMA_SKIP_ON_TIMEOUT: "0",
  ALLOW_SCHEMA_SKIP_ON_TIMEOUT: "0",
  BACKEND_PYTHON: pythonBin,
  UI_E2E_PYTHON: pythonBin,
  UI_E2E_LABEL_PREFIX: process.env.UI_E2E_LABEL_PREFIX || "UAT-GREEN",
  UI_E2E_RUN_TAG: runTag,
  UI_E2E_GREEN_RUN: "1",
  UI_E2E_FRONTEND_MODE: process.env.UI_E2E_FRONTEND_MODE || "prod",
  FRONTEND_MODE: process.env.FRONTEND_MODE || process.env.UI_E2E_FRONTEND_MODE || "prod",
}

fs.mkdirSync(runtimeRoot, { recursive: true })
writeRunMetadata()
assertNoProtectedDuplicateFiles()

trimIdleDbConnections(strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "manage.py"), "migrate", "--noinput"], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "manage.py"), "migrate", "--check"], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e.py")], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_quotations.py")], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_sales.py")], strictEnv)
runOrThrow(
  pythonBin,
  [path.join(repoRoot, "manage.py"), "bootstrap_report_smoke", "--allow-production", "--send-now"],
  strictEnv,
)
runOrThrow(
  pythonBin,
  [path.join(repoRoot, "manage.py"), "seed_notification_baseline", "--allow-production"],
  strictEnv,
)
runOrThrow(
  pythonBin,
  [path.join(repoRoot, "manage.py"), "seed_controlled_telemetry", "--apply"],
  strictEnv,
)
runOrThrow(
  pythonBin,
  [path.join(repoRoot, "manage.py"), "run_tagged_acceptance", "--report-dir", path.join(runtimeRoot, "acceptance")],
  strictEnv,
)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/verify_uat_business_truth.py")], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_planner_gate.py")], strictEnv)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_mutations.py")], strictEnv)
runOrThrow(npmBin, ["run", "e2e:ui"], { ...strictEnv, UI_E2E_SKIP_BOOTSTRAP: "1" }, frontendRoot)
runOrThrow(pythonBin, [path.join(repoRoot, "scripts/write_uat_green_manifest.py")], strictEnv)

const summaryPath = path.join(runtimeRoot, "release-readiness-summary.json")
if (!fs.existsSync(summaryPath)) {
  throw new Error("release-readiness-summary.json was not produced.")
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"))
if (summary.status !== "passed" || Number(summary.counts?.failed || 0) > 0) {
  throw new Error(`Release green sweep failed. Summary status=${summary.status}, failed=${summary.counts?.failed || 0}.`)
}

console.log(`Release green sweep passed. Summary: ${summaryPath}`)
