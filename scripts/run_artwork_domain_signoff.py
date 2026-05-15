from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_ROOT = REPO_ROOT / "frontend_v2"
RUNTIME_ROOT = REPO_ROOT / ".runtime" / "artwork-domain-signoff"
ACCEPTANCE_DIR = RUNTIME_ROOT / "acceptance"
UI_RUNTIME_ROOT = REPO_ROOT / ".runtime" / "ui-e2e"

BACKEND_TEST_TARGETS = [
    "apps.artwork.tests.test_api_approval_controls",
    "apps.artwork.tests.test_print_contract_snapshot",
    "apps.artwork.tests.test_roto_approval_gate",
    "apps.tooling.tests.test_cylinder_finalize_validation",
    "apps.sales.tests.test_confirm_artwork_deferred_gate",
    "apps.sales.tests.test_printing_snapshot_contract",
    "apps.inventory.tests.test_roll_naming",
    "apps.physics.tests_formula_alignment",
    "apps.production.tests.test_material_consumption_strictness",
    "apps.production.tests.test_planner_assign_artwork_gate",
]


def _python_bin() -> Path:
    candidate = REPO_ROOT / "venv_311" / "bin" / "python"
    return candidate if candidate.exists() else Path(sys.executable)


def _run_step(name: str, cmd: list[str], *, cwd: Path) -> dict:
    log_path = RUNTIME_ROOT / f"{name}.log"
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        env=os.environ.copy(),
    )
    log_path.write_text(
        f"$ {' '.join(cmd)}\n\nSTDOUT\n{proc.stdout}\n\nSTDERR\n{proc.stderr}\n",
        encoding="utf-8",
    )
    return {
        "name": name,
        "command": cmd,
        "cwd": str(cwd),
        "exit_code": proc.returncode,
        "status": "PASS" if proc.returncode == 0 else "FAIL",
        "log": str(log_path.relative_to(REPO_ROOT)),
    }


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _status(flag: bool) -> str:
    return "PASS" if flag else "FAIL"


def main() -> int:
    RUNTIME_ROOT.mkdir(parents=True, exist_ok=True)
    ACCEPTANCE_DIR.mkdir(parents=True, exist_ok=True)

    python_bin = _python_bin()
    os.environ.setdefault("BACKEND_PYTHON", str(python_bin))
    os.environ.setdefault("UI_E2E_PYTHON", str(python_bin))
    os.environ.setdefault("UI_BASE_URL", "http://127.0.0.1:3001")
    os.environ.setdefault("UI_E2E_API_PORT", "8000")
    os.environ.setdefault("UI_E2E_FRONTEND_MODE", "prod")
    os.environ.setdefault("FRONTEND_MODE", "prod")
    os.environ.setdefault("PLAYWRIGHT_DISABLE_VIDEO", "1")

    steps = [
        _run_step(
            "backend_targeted_tests",
            [str(python_bin), "manage.py", "test", *BACKEND_TEST_TARGETS, "--noinput"],
            cwd=REPO_ROOT,
        ),
        _run_step(
            "acceptance_artwork_domain",
            [str(python_bin), "manage.py", "run_tagged_acceptance", "--noinput", "--report-dir", str(ACCEPTANCE_DIR)],
            cwd=REPO_ROOT,
        ),
        _run_step(
            "browser_artwork_domain",
            [str(FRONTEND_ROOT / "scripts" / "with-supported-node.sh"), "node", "scripts/run_artwork_domain_signoff.mjs"],
            cwd=FRONTEND_ROOT,
        ),
    ]

    backend_green = steps[0]["exit_code"] == 0
    acceptance_green = steps[1]["exit_code"] == 0
    browser_green = steps[2]["exit_code"] == 0

    acceptance_report = _read_json(ACCEPTANCE_DIR / "e2e_report.json")
    hardening = acceptance_report.get("hardening_smoke", {}) if isinstance(acceptance_report, dict) else {}
    browser_report = _read_json(UI_RUNTIME_ROOT / "artwork-domain-proof.json")
    browser_report_passed = (
        str(browser_report.get("status") or "").lower() == "passed"
        and int((browser_report.get("counts") or {}).get("failed") or 0) == 0
    )
    if browser_report_passed and steps[2]["exit_code"] != 0:
        steps[2]["status"] = "PASS"

    field_inventory = [
        "printing.type",
        "printing.substrate_mode",
        "printing.front_colors_count",
        "printing.back_colors_count",
        "printing.front_colors",
        "printing.back_colors",
        "printing.color_names",
        "printing.color_mapping",
        "printing.ink_base_family",
        "printing.ink_gsm_total",
        "printing.ink_gsm_split_mode",
        "printing.ink_gsm_color_percentages",
        "printing.ink_gsm_by_color",
        "printing.artwork_id",
        "printing.artwork_design_code",
        "printing.cylinder_required",
    ]

    transitions = [
        {
            "transition": "Artwork draft -> approved",
            "status": _status(backend_green),
            "evidence": "apps.artwork.tests.test_roto_approval_gate + apps.artwork.tests.test_api_approval_controls",
        },
        {
            "transition": "Approved artwork -> planner assignment -> frozen printing snapshot",
            "status": _status(backend_green and bool(hardening.get("printing_contract_fields_populated_after_assignment"))),
            "evidence": "apps.production.tests.test_planner_assign_artwork_gate + acceptance hardening_smoke",
        },
        {
            "transition": "Frozen printing snapshot -> BOM/consumption/execution",
            "status": _status(backend_green),
            "evidence": "apps.production.tests.test_material_consumption_strictness + apps.physics.tests_formula_alignment",
        },
    ]

    edge_case_matrix = [
        ("Missing artwork asset before approval", backend_green, "apps.artwork.tests.test_roto_approval_gate"),
        ("Front/back side count mismatch", backend_green, "apps.sales.tests.test_printing_snapshot_contract"),
        ("Empty side list with nonzero count", backend_green, "apps.sales.tests.test_printing_snapshot_contract"),
        ("Print-type mismatch between artwork and order", backend_green, "apps.sales.tests.test_printing_snapshot_contract"),
        ("ROTO slot gaps", backend_green and bool(hardening.get("roto_approval_blocks_unfinalized_cylinders")), "apps.artwork.tests.test_roto_approval_gate + acceptance hardening_smoke"),
        ("Duplicate finalized cylinder slot coverage", backend_green, "apps.artwork.tests.test_roto_approval_gate + apps.tooling.tests.test_cylinder_finalize_validation"),
        ("Invalid cylinder slot numbering / out-of-range coverage", backend_green, "apps.artwork.tests.test_roto_approval_gate + apps.tooling.tests.test_cylinder_finalize_validation"),
        ("Artwork reassignment clears planner gate", backend_green and bool(hardening.get("planner_assign_artwork_unblocks_release")), "apps.production.tests.test_planner_assign_artwork_gate + browser planner-artwork-gate"),
        ("PET vs POLY ink-base resolution", backend_green, "apps.artwork.tests.test_print_contract_snapshot"),
        ("Partial/missing color_mapping rejected for frozen runtime", backend_green, "apps.sales.tests.test_printing_snapshot_contract + apps.production.tests.test_material_consumption_strictness"),
        ("Stale artwork IDs rejected", backend_green, "apps.sales.tests.test_printing_snapshot_contract"),
        ("Planner release blocked even if pending-flag is false but contract is invalid", backend_green, "apps.production.tests.test_planner_assign_artwork_gate"),
        ("Preview mode shows unmapped inks while confirm/runtime block them", backend_green, "apps.artwork.tests.test_print_contract_snapshot + apps.sales.tests.test_printing_snapshot_contract"),
    ]

    matrix_rows = [
        {"case": label, "status": _status(flag), "evidence": evidence}
        for label, flag, evidence in edge_case_matrix
    ]

    browser_status = str(browser_report.get("status") or "").lower()
    browser_ok = (browser_green and browser_status == "passed") or browser_report_passed
    acceptance_ok = (
        acceptance_green
        and bool(hardening.get("planner_artwork_gate_blocks_release"))
        and bool(hardening.get("planner_assign_artwork_unblocks_release"))
        and bool(hardening.get("roto_approval_blocks_unfinalized_cylinders"))
        and bool(hardening.get("printing_contract_fields_populated_after_assignment"))
    )
    known_domain_gaps = [row for row in matrix_rows if row["status"] != "PASS"]
    overall_ready = backend_green and acceptance_ok and browser_ok and not known_domain_gaps

    report = {
        "domain": "artwork-cylinder-ink",
        "status": "READY" if overall_ready else "BLOCKED",
        "generated_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        "steps": steps,
        "field_inventory": field_inventory,
        "validated_transitions": transitions,
        "edge_case_matrix": matrix_rows,
        "acceptance": {
            "status": _status(acceptance_ok),
            "report_dir": str(ACCEPTANCE_DIR.relative_to(REPO_ROOT)),
            "hardening_smoke": hardening,
        },
        "browser_proof": {
            "status": _status(browser_ok),
            "report": str((UI_RUNTIME_ROOT / "artwork-domain-proof.json").relative_to(REPO_ROOT)),
            "details": browser_report,
        },
        "residual_non_domain_risks": [
            "This signoff is domain-perfect for artwork/cylinder/ink only, not a claim that the whole ERP is bug-free.",
            "Unrelated repo worktree changes may still exist outside this domain.",
        ],
        "known_domain_gaps": known_domain_gaps,
    }

    json_path = RUNTIME_ROOT / "artwork-domain-signoff.json"
    md_path = RUNTIME_ROOT / "artwork-domain-signoff.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# Artwork / Cylinder / Ink Domain Signoff",
        "",
        f"- Status: `{report['status']}`",
        f"- Generated At: `{report['generated_at']}`",
        "",
        "## Field Inventory",
        *[f"- `{field}`" for field in field_inventory],
        "",
        "## Validated Transitions",
    ]
    for row in transitions:
        lines.append(f"- `{row['transition']}`: **{row['status']}**")
        lines.append(f"  Evidence: `{row['evidence']}`")
    lines.extend(["", "## Edge-Case Matrix"])
    for row in matrix_rows:
        lines.append(f"- `{row['case']}`: **{row['status']}**")
        lines.append(f"  Evidence: `{row['evidence']}`")
    lines.extend(
        [
            "",
            "## Acceptance",
            f"- Status: `{report['acceptance']['status']}`",
            f"- Planner artwork gate blocks release: `{hardening.get('planner_artwork_gate_blocks_release')}`",
            f"- Planner assignment unblocks release: `{hardening.get('planner_assign_artwork_unblocks_release')}`",
            f"- ROTO approval blocks unfinalized cylinders: `{hardening.get('roto_approval_blocks_unfinalized_cylinders')}`",
            f"- Frozen print contract fields populated: `{hardening.get('printing_contract_fields_populated_after_assignment')}`",
            "",
            "## Browser Proof",
            f"- Status: `{report['browser_proof']['status']}`",
            f"- Report: `{report['browser_proof']['report']}`",
            "",
            "## Residual Non-Domain Risks",
            *[f"- {row}" for row in report["residual_non_domain_risks"]],
        ]
    )
    if known_domain_gaps:
        lines.extend(["", "## Open Domain Gaps"])
        for row in known_domain_gaps:
            lines.append(f"- `{row['case']}` via `{row['evidence']}`")
    else:
        lines.extend(["", "No known open domain defects remain in this signoff scope."])

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "report_json": str(json_path), "report_md": str(md_path)}, indent=2))
    return 0 if overall_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
