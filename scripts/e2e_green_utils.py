from __future__ import annotations

import os
import re
from pathlib import Path

from django.utils import timezone


LABEL_PREFIX = str(os.environ.get("UI_E2E_LABEL_PREFIX", "UAT-GREEN") or "UAT-GREEN").strip() or "UAT-GREEN"
CODE_PREFIX = re.sub(r"[^A-Z0-9]+", "-", LABEL_PREFIX.upper()).strip("-") or "UAT-GREEN"


def runtime_dir() -> Path:
    target = Path(os.environ.get("UI_E2E_RUNTIME_DIR", Path(os.getcwd()) / ".runtime" / "ui-e2e"))
    target.mkdir(parents=True, exist_ok=True)
    return target


def current_run_tag() -> str:
    raw = str(os.environ.get("UI_E2E_RUN_TAG") or "").strip()
    if raw:
        return raw
    return timezone.now().strftime("%Y%m%d%H%M%S")


def label(text: str) -> str:
    suffix = str(text or "").strip()
    return f"{LABEL_PREFIX} {suffix}".strip()


def code(text: str) -> str:
    suffix = re.sub(r"[^A-Z0-9]+", "-", str(text or "").upper()).strip("-")
    if not suffix:
        return CODE_PREFIX
    return f"{CODE_PREFIX}-{suffix}".strip("-")


def prefixed(value: object) -> bool:
    text = str(value or "").strip()
    upper_text = text.upper()
    return text.startswith(LABEL_PREFIX) or upper_text.startswith(CODE_PREFIX)
