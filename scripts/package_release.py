#!/usr/bin/env python3
"""Validate and package a Foundry VTT system for GitHub Releases.

Release archive contains Foundry runtime files at zip root, including system.json.
Run with Python 3.10+ from repository root. No third-party dependencies.
"""
import json
import os
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
REPO = os.environ.get("GITHUB_REPOSITORY", "Danacra/project-genesis")
RUNTIME_FOLDERS = ("assets", "lang", "module", "styles", "templates")
RUNTIME_FILES = ("genesis.mjs",)


def package():
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", REPO):
        raise ValueError(f"Invalid GitHub repository: {REPO}")
    data = json.loads((ROOT / "system.json").read_text(encoding="utf-8"))
    if data.get("id") != "project-genesis":
        raise ValueError("System id must remain 'project-genesis'.")
    version = data.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Expected X.Y.Z version in system.json")
    tag = "v" + version
    base = f"https://github.com/{REPO}"
    data["url"] = base
    data["manifest"] = f"{base}/releases/latest/download/system.json"
    data["download"] = f"{base}/releases/download/{tag}/project-genesis.zip"
    expected_tag = os.environ.get("RELEASE_TAG")
    if expected_tag and expected_tag != tag:
        raise ValueError(f"Release tag {expected_tag} does not match manifest version {tag}")
    if not (ROOT / "genesis.mjs").is_file():
        raise FileNotFoundError("Foundry entrypoint missing: genesis.mjs")
    for sub in RUNTIME_FOLDERS:
        if not (ROOT / sub).is_dir():
            raise FileNotFoundError(f"Foundry runtime folder missing: {sub}")
    DIST.mkdir(exist_ok=True)
    manifest = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    (DIST / "system.json").write_text(manifest, encoding="utf-8")
    archive = DIST / "project-genesis.zip"
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("system.json", manifest)
        for filename in RUNTIME_FILES:
            z.write(ROOT / filename, filename)
        for folder in RUNTIME_FOLDERS:
            for path in sorted((ROOT / folder).rglob('*')):
                if path.is_file() and not path.is_symlink():
                    z.write(path, path.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(archive) as z:
        assert z.testzip() is None, "Invalid ZIP"
        installed = json.loads(z.read('system.json'))
        assert installed == data, "Manifest mismatch"
        assert all(not name.startswith('project-genesis/') for name in z.namelist())
        assert len(z.namelist()) >= 30, "Unexpectedly empty release"
    print(f"Built {archive} ({archive.stat().st_size} bytes); {tag}")
    print(f"Manifest URL (usable after publication): {data['manifest']}")

if __name__ == '__main__':
    try: package()
    except Exception as err:
        print(f"ERROR: {err}", file=sys.stderr)
        sys.exit(1)
