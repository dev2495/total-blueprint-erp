#!/usr/bin/env python3
"""Prepare a tracked-only private release archive from a reviewed clean commit."""
import argparse
import hashlib
import json
import subprocess
import tarfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[3]
PROVENANCE = json.loads((Path(__file__).parent / "source-provenance.json").read_text())


def git(*arguments):
    return subprocess.check_output(["git", *arguments], cwd=ROOT, text=True).strip()


def prepare(destination):
    source = git("rev-parse", "HEAD")
    if git("status", "--porcelain"):
        raise RuntimeError("Commit the reviewed source before creating the release archive.")
    subprocess.run(["git", "merge-base", "--is-ancestor", PROVENANCE["recovered_commit"], source], cwd=ROOT, check=True)
    if git("rev-parse", PROVENANCE["recovered_commit"] + "^{tree}") != PROVENANCE["recovered_tree"]:
        raise RuntimeError("Recovered private source provenance changed.")
    migrations = json.loads((Path(__file__).parent / "reviewed-migrations.json").read_text())
    if not migrations:
        raise RuntimeError("Review and freeze the new additive bill migrations before archiving.")
    destination = destination.resolve()
    if destination.exists():
        raise RuntimeError("Preserve the existing archive and select a new destination.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "archive", "--format=tar.gz", "--output", str(destination), source], cwd=ROOT, check=True)
    with tarfile.open(destination, "r:gz") as archive:
        for member in archive.getmembers():
            parts = PurePosixPath(member.name).parts
            private = {".git", ".runtime", ".venv", "node_modules", ".next", ".env", ".env.local", ".env.production", "app.env"}
            if member.name.startswith("/") or ".." in parts or private.intersection(parts) or not (member.isdir() or member.isfile()):
                raise RuntimeError("Release archive contains a private or unsafe member.")
    return {
        "status": "PASS", "candidate_sha": source, "expected_deployed_parent": PROVENANCE["deployed_parent"],
        "recovered_private_baseline": PROVENANCE["recovered_commit"], "archive": str(destination),
        "archive_sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "private_repair_history_retained": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    print(json.dumps(prepare(args.destination), sort_keys=True))
