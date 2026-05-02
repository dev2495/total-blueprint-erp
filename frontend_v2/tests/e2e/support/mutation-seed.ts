import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { readRuntimeJson } from "./test-helpers"

export interface MutationSeedMetadata {
  seeded_at: string
  admin_username: string
  operator: {
    machine_id: string
    machine_code: string
    job_id: string
    job_number: string
    assignment_id: string
  }
  wcm: {
    work_center_id: string
    work_center_code: string
    machine_id: string
    machine_code: string
    job_id: string
    job_number: string
    assignment_id: string
  }
  grn: {
    plant_id: string
    plant_name: string
    bulk_location_id: string
    bulk_location_name: string
    roll_location_id: string
    roll_location_name: string
    vendor_id: string
    vendor_code: string
    bulk_material_id: string
    bulk_material_code: string
    roll_material_id: string
    roll_material_code: string
    roll_label_prefix: string
  }
  interplant: {
    from_plant_id: string
    from_plant_code: string
    from_plant_name: string
    to_plant_id: string
    to_plant_code: string
    to_plant_name: string
    destination_location_id: string
    destination_location_name: string
    roll_id: string
    roll_label: string
  }
  jobwork: {
    plant_id: string
    plant_code: string
    plant_name: string
    vendor_id: string
    vendor_code: string
    production_job_id: string
    production_job_number: string
    source_roll_id: string
    source_roll_label: string
    receive_location_id: string
    receive_location_name: string
    return_material_id: string
    return_material_code: string
    return_grade_id: string
  }
  dispatch: {
    sales_order_id: string
    sales_order_number: string
    roll_id: string
    roll_ids?: string[]
    roll_label: string
    packaging_material_id: string
    packaging_material_code: string
    packaging_qty: number
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd()
  return cwd.endsWith(`${path.sep}frontend_v2`) ? path.resolve(cwd, "..") : cwd
}

function resolvePython(repoRoot: string) {
  const envCandidates = [process.env.UI_E2E_PYTHON, process.env.BACKEND_PYTHON].filter(Boolean) as string[]
  const candidates = [
    ...envCandidates,
    path.join(repoRoot, "venv_311/bin/python"),
    path.join(repoRoot, ".venv-validate/bin/python"),
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return path.join(repoRoot, "venv_311/bin/python")
}

export function refreshMutationSeed() {
  const repoRoot = resolveRepoRoot()
  const pythonBin = resolvePython(repoRoot)
  execFileSync(pythonBin, [path.join(repoRoot, "scripts/seed_ui_e2e_mutations.py")], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      SKIP_DOTENV_IMPORT: process.env.SKIP_DOTENV_IMPORT || "1",
      SKIP_CELERY_IMPORT: process.env.SKIP_CELERY_IMPORT || "1",
    },
  })
}

export function readMutationSeed(options: { refresh?: boolean } = {}): MutationSeedMetadata {
  if (options.refresh) {
    refreshMutationSeed()
  }
  const seed = readRuntimeJson<MutationSeedMetadata>("mutation-seed.json")
  if (!seed) {
    throw new Error("Missing mutation-seed.json runtime metadata.")
  }
  return seed
}
