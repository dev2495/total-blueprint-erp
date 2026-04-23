from __future__ import annotations

from typing import Iterable


CANONICAL_ROLE_LABELS = {
    "ADMIN": "Admin",
    "OWNER": "Owner",
    "SUPER_ADMIN": "Admin",
    "SALES": "Sales",
    "PLANNER": "Planner",
    "WORK_CENTER_MANAGER": "Work Center Manager",
    "ENGINEERING": "Engineering",
    "STORE": "Store",
    "DISPATCH": "Dispatch",
    "PLANT_MANAGER": "Plant Manager",
}


LEGACY_ROLE_CODE_ALIASES = {
    "SUPER_ADMIN": "ADMIN",
    "ENGINEER": "ENGINEERING",
    "WC_MANAGER": "WORK_CENTER_MANAGER",
    "OPERATOR": "WORK_CENTER_MANAGER",
    "INVENTORY": "STORE",
    "PRODUCTION_MANAGER": "PLANT_MANAGER",
}


CANONICAL_ROLE_ORDER = [
    "ADMIN",
    "OWNER",
    "SALES",
    "PLANNER",
    "WORK_CENTER_MANAGER",
    "ENGINEERING",
    "STORE",
    "DISPATCH",
    "PLANT_MANAGER",
]


def get_canonical_role_code(role_code: str | None) -> str:
    normalized = str(role_code or "").strip().upper()
    if not normalized:
        return ""
    return LEGACY_ROLE_CODE_ALIASES.get(normalized, normalized)


def get_canonical_role_name(role_code: str | None, fallback: str | None = None) -> str:
    canonical_code = get_canonical_role_code(role_code)
    if canonical_code and canonical_code in CANONICAL_ROLE_LABELS:
        return CANONICAL_ROLE_LABELS[canonical_code]
    value = str(fallback or "").strip()
    if value:
        return value
    return canonical_code.title().replace("_", " ") if canonical_code else "Guest"


def canonicalize_role_rows(rows: Iterable[object]) -> list[dict]:
    merged: dict[str, dict] = {}

    for row in rows or []:
        raw_code = str(getattr(row, "code", "") or "").upper()
        canonical_code = get_canonical_role_code(raw_code)
        if not canonical_code or canonical_code not in CANONICAL_ROLE_LABELS:
            continue

        default_permissions = list(getattr(row, "default_permissions", []) or [])
        candidate = {
            "id": str(getattr(row, "id", "") or ""),
            "code": canonical_code,
            "name": get_canonical_role_name(canonical_code, getattr(row, "name", "")),
            "description": str(getattr(row, "description", "") or ""),
            "default_permissions": sorted(set(default_permissions)),
        }

        existing = merged.get(canonical_code)
        if not existing:
            merged[canonical_code] = candidate
            continue

        prefer_candidate = raw_code == canonical_code and existing.get("code") != canonical_code
        if prefer_candidate:
            merged[canonical_code] = {
                **candidate,
                "default_permissions": sorted(
                    set(existing.get("default_permissions", [])) | set(candidate["default_permissions"])
                ),
            }
            continue

        existing["default_permissions"] = sorted(
            set(existing.get("default_permissions", [])) | set(candidate["default_permissions"])
        )

    return sorted(
        merged.values(),
        key=lambda row: (
            CANONICAL_ROLE_ORDER.index(row["code"]) if row["code"] in CANONICAL_ROLE_ORDER else 999,
            row["name"],
        ),
    )


def canonicalize_role_matrix(matrix: dict[str, dict]) -> dict[str, dict]:
    merged: dict[str, dict] = {}

    for raw_code, row in (matrix or {}).items():
        canonical_code = get_canonical_role_code(raw_code)
        if not canonical_code or canonical_code not in CANONICAL_ROLE_LABELS:
            continue

        existing = merged.get(canonical_code, {"default_permissions": [], "database_permissions": []})
        merged[canonical_code] = {
            "default_permissions": sorted(
                set(existing.get("default_permissions", [])) | set((row or {}).get("default_permissions", []) or [])
            ),
            "database_permissions": sorted(
                set(existing.get("database_permissions", [])) | set((row or {}).get("database_permissions", []) or [])
            ),
        }

    return {
        role_code: merged[role_code]
        for role_code in CANONICAL_ROLE_ORDER
        if role_code in merged
    }
