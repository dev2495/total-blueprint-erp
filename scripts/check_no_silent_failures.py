"""Fail the release gate when critical flow modules silently swallow exceptions.

The audited modules may deliberately fall back after a lookup/calculation error,
but those paths must log or re-raise so operators and telemetry can see the
degraded behavior. This check is intentionally scoped to the business-critical
master, route, planner, and in-house-demand surfaces; it does not outlaw normal
defensive parsing across the entire repository.
"""

from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CRITICAL_FILES = (
    "apps/materials/naming.py",
    "apps/materials/serializers.py",
    "apps/materials/views.py",
    "apps/production/services/in_house_demand_service.py",
    "apps/production/services/roll_allocation_service.py",
    "apps/production/services/services_execution.py",
    "apps/production/services/stock_validator.py",
    "apps/production/views_planner.py",
)


def _bare_pass_handlers(path: Path) -> list[int]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    lines: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ExceptHandler):
            continue
        if any(isinstance(statement, ast.Pass) for statement in node.body):
            lines.append(node.lineno)
    return lines


def main() -> int:
    failures: list[str] = []
    for relative in CRITICAL_FILES:
        path = ROOT / relative
        for line in _bare_pass_handlers(path):
            failures.append(f"{relative}:{line}")
    if failures:
        print("Silent exception handlers found in critical flow modules:")
        print("\n".join(f"- {item}" for item in failures))
        return 1
    print(f"No bare exception pass handlers found in {len(CRITICAL_FILES)} critical flow modules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
