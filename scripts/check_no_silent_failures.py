"""Fail the release gate when critical flow modules silently swallow exceptions.

The audited modules may deliberately fall back after a lookup/calculation error,
but those paths must log or re-raise so operators and telemetry can see the
degraded behavior. The scan covers the application and configuration Python
sources while excluding no business-flow modules; it does not outlaw normal
defensive parsing when the exception path is observable.
"""

from __future__ import annotations

import ast
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOTS = (ROOT / "apps", ROOT / "config")


def _source_files() -> list[Path]:
    return sorted(path for root in SCAN_ROOTS for path in root.rglob("*.py"))


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
    source_files = _source_files()
    for path in source_files:
        relative = path.relative_to(ROOT)
        for line in _bare_pass_handlers(path):
            failures.append(f"{relative}:{line}")
    if failures:
        print("Silent exception handlers found in critical flow modules:")
        print("\n".join(f"- {item}" for item in failures))
        return 1
    print(f"No bare exception pass handlers found in {len(source_files)} application/configuration Python modules.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
