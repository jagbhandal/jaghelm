#!/usr/bin/env python3
"""Dependency-free secret scanner — the harness floor's enforcers control.

Scans for committed credentials (private keys, cloud keys, provider tokens, and
secret-looking assignments). High-precision by design: distinctive formats + a
conservative generic rule that ignores obvious placeholders, so it can run blocking
in CI without drowning a repo in false positives. No dependencies, deterministic.

Usage:
  python3 scripts/secret-scan.py [PATH ...]   # scan given files, or git-tracked files
Exit: 0 = clean, 1 = findings, 2 = bad input.

False positive? Append  # pragma: allowlist secret  to the line. Upgrade path: a
repo that outgrows this can swap in gitleaks/trufflehog (document it in the manifest).
"""

import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from secret_rules import RULES, GENERIC, ALLOW, is_placeholder  # noqa: E402

SKIP_DIRS = {".git", "node_modules", "dist", "build", "vendor", ".venv", "venv",
             "__pycache__", ".cache", "coverage", ".next", "target"}
SKIP_SUFFIX = (".min.js", ".min.css", ".map", ".svg", ".png", ".jpg",
               ".jpeg", ".gif", ".ico", ".pdf", ".woff", ".woff2", ".ttf")
GENERIC_SKIP_SUFFIX = (".lock",)
GENERIC_SKIP_NAMES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock",
                      "bun.lock", "Cargo.lock", "poetry.lock"}


def tracked_files():
    """Files to scan when no explicit paths are given: git-tracked, else a plain walk.
    (A gitignored local file like a local-only .env is not a committed leak.)"""
    try:
        out = subprocess.run(["git", "ls-files"], capture_output=True, text=True, timeout=30)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.splitlines()
    except (OSError, subprocess.SubprocessError):
        pass
    files = []  # fall back to a plain walk
    for root, dirs, names in os.walk("."):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        files.extend(os.path.join(root, n) for n in names)
    return files


def scannable(path):
    # binary/asset files never have scannable text; the scanner's own source is excluded
    if os.path.basename(path) == "secret-scan.py" or path.endswith(SKIP_SUFFIX):
        return False
    return True  # FORMAT rules run on EVERYTHING else, incl .example / .sample


def generic_excluded(path):
    """Lockfiles / generated files: run FORMAT rules but suppress the noisy GENERIC rule."""
    name = os.path.basename(path)
    return name in GENERIC_SKIP_NAMES or path.endswith(GENERIC_SKIP_SUFFIX)


def redact(s):
    s = s.strip()
    return s if len(s) <= 4 else f"{s[:4]}***{s[-2:]}"


def main(argv):
    if argv:  # explicit paths given (e.g. by the pre-commit hook)
        files = [a for a in argv if os.path.isfile(a)]
        if not files:
            print(f"error: none of the given path(s) resolve to a file: {' '.join(argv)}",
                  file=sys.stderr)
            return 2  # don't report a no-op scan as clean
    else:
        files = tracked_files()

    findings = []
    for path in sorted(set(files)):
        if not scannable(path):
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except OSError:
            continue  # unreadable — skip (a decodable-with-replacement file is still scanned)
        for n, line in enumerate(lines, 1):
            if ALLOW.search(line):
                continue
            for rule_name, pat in RULES:
                m = pat.search(line)
                if m:
                    findings.append((path, n, rule_name, redact(m.group(0))))
            g = GENERIC.search(line)
            if g and not generic_excluded(path) and not is_placeholder(g.group(2)):
                findings.append((path, n, f"secret-assignment ({g.group(1)})", redact(g.group(2))))

    # collapse the same secret matched by two rules on one line (keep the first/specific)
    seen, deduped = set(), []
    for f in findings:
        key = (f[0], f[1], f[3])
        if key not in seen:
            seen.add(key)
            deduped.append(f)
    findings = deduped

    if findings:
        print(f"✗ {len(findings)} potential secret(s) found:")
        for path, n, kind, hint in findings:
            print(f"  {path}:{n}  [{kind}]  {hint}")
        print("\nRemove the secret + rotate it. False positive? add "
              "'# pragma: allowlist secret' to the line.")
        return 1
    print("✓ no secrets detected")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
