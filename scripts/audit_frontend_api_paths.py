#!/usr/bin/env python3
"""
Audit frontend `/api/...` usages against Django URL resolver.

Goal: catch broken/typo'd API paths early, without needing a running server.

Notes:
- This is a best-effort static scan; it replaces `${...}` placeholders with a sample UUID.
- It checks resolve() for both slash and no-slash variants and reports if neither matches.
"""

from __future__ import annotations

import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


SAMPLE_UUID = "00000000-0000-0000-0000-000000000000"

# Match '/api/...' inside single/double/backtick strings (simple heuristic).
API_STRING_RE = re.compile(r"""['"`](/api/[^'"`\s]+)['"`]""")
TEMPLATE_EXPR_RE = re.compile(r"\$\{[^}]+\}")


@dataclass(frozen=True)
class Hit:
    file: str
    line: int
    raw: str


def iter_source_files(root: Path) -> Iterable[Path]:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
            continue
        # Skip build/vendor dirs
        parts = set(p.parts)
        if "node_modules" in parts or ".next" in parts or ".turbo" in parts:
            continue
        yield p


def scan_frontend_api_strings(frontend_src: Path) -> list[Hit]:
    hits: list[Hit] = []
    for f in iter_source_files(frontend_src):
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in API_STRING_RE.finditer(text):
            raw = m.group(1)
            line = text.count("\n", 0, m.start()) + 1
            hits.append(Hit(file=str(f), line=line, raw=raw))
    return hits


def normalize_for_resolve(raw: str) -> str:
    # Drop query string for resolver match.
    path = raw.split("?", 1)[0]
    # Replace template expressions with a UUID placeholder.
    path = TEMPLATE_EXPR_RE.sub(SAMPLE_UUID, path)
    return path


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    frontend_src = repo_root / "frontend_v2" / "src"
    if not frontend_src.exists():
        print(f"ERROR: frontend_v2/src not found at {frontend_src}", file=sys.stderr)
        return 2

    # Django bootstrap (no DB required for resolve()).
    sys.path.append(str(repo_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django

    django.setup()
    from django.urls import resolve
    from django.urls.exceptions import Resolver404

    hits = scan_frontend_api_strings(frontend_src)
    unresolved: list[tuple[Hit, str]] = []

    for hit in hits:
        path = normalize_for_resolve(hit.raw)
        candidates = [path, path.rstrip("/") + "/", path.rstrip("/")]
        candidates = [c for i, c in enumerate(candidates) if c and c not in candidates[:i]]

        ok = False
        for c in candidates:
            try:
                resolve(c)
                ok = True
                break
            except Resolver404:
                continue

        if not ok:
            unresolved.append((hit, path))

    print(f"Scanned {len(hits)} '/api/*' string usages.")
    if not unresolved:
        print("OK: All matched at least one Django URL pattern.")
        return 0

    print(f"FOUND {len(unresolved)} unresolved API paths:\n")
    for hit, normalized in unresolved[:200]:
        print(f"- {hit.file}:{hit.line}  raw={hit.raw}  normalized={normalized}")

    if len(unresolved) > 200:
        print(f"\n... and {len(unresolved) - 200} more")

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

