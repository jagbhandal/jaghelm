# JagHelm Mobile — Phase 0: Floor Secret-Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the canonical secret floor (scanner + scrubber + scan.py evidence) so a GCP service-account JSON or PEM private key cannot land in the public jaghelm repo or escape via Elrond egress — the required-first gate before any FCM/keystore code.

**Architecture:** A shared `secret_rules.RULES` registry consumed by both `secret-scan.py` (commit/CI gate) and `scrub-payload.py` (Elrond egress), plus `scan.py` evidence hardening; then jaghelm re-instantiates the hardened floor and adds .gitignore negations + a template-tracked CI assertion. Work spans three repos: homelab-infra (canonical floor — worktree+PR), nanoclaw-v2 (scrubber — worktree+PR), jaghelm (instantiation — branch+PR).

**Tech Stack:** Python 3 (stdlib only — dependency-free floor), the repos' existing test runners, GitHub/Gitea Actions YAML.

## Global Constraints

- **stdlib-only floor** — the secret floor (`secret_rules.py`, `secret-scan.py`, `scan.py`, `scrub-payload.py`) must use only the Python 3 standard library; no third-party dependencies may be introduced.
- **deploy checkouts (homelab-infra, nanoclaw-v2) get worktree+branch→PR→human-merge** — do all dev in a git worktree off `main`, branch, open a PR, and a human merges. Never push to main, never merge the PR yourself.
- **homelab-infra is SSH-push-only** — push the branch over SSH and hand over the create-PR URL; do not attempt to open the PR via API.
- **jaghelm branch→PR** — branch in a worktree, open a PR, human merges.
- **NEVER commit secrets** — example/template files use clearly-fake placeholder keys only; planted-key regression tests write to `mktemp` paths outside the worktree and delete them.
- **nothing FCM/keystore/google-services.json lands until this merges** — no FCM, keystore, or `google-services.json` code or real credentials may be added to jaghelm until this Phase 0 floor is merged.
- **Elrond review stays disabled on secret-adjacent diffs until the shared registry lands** — do not enable Elrond egress review on any secret-adjacent diff until the shared `secret_rules` registry (Part A + Part B) is merged.

---

# Part A — homelab-infra (canonical floor)

> Part A lands first because Part B imports/vendors A's `secret_rules` registry. All Part A work is in a worktree off `homelab-infra` `main`; homelab-infra is SSH-push-only → push the branch, hand over the create-PR URL, human merges. Tests run standalone via `python3 <file>` (exit code 0 = pass). Absolute paths throughout.

## Task A1 — create `secret_rules.py` (the shared registry + entropy-gated placeholder)

**Files**
- create `/home/ilaaj-agent/homelab-infra/docs/harness/templates/floor/secret_rules.py`
- create test `/home/ilaaj-agent/homelab-infra/docs/harness/secret_rules.test.py`

**Interfaces** — consumes: nothing. produces: `RULES` (list of `(name, compiled)`), `GENERIC`, `ALLOW`, `PEM_PRIVATE_KEY`, `GCP_SERVICE_ACCOUNT_TYPE`, `GCP_SERVICE_ACCOUNT_KEY`, `is_placeholder(val, entropy_floor=3.0)`, `shannon_entropy(s)`.

**Steps**

- [ ] 1. Write the failing test. The module under test lives in `templates/floor/`, so the test inserts that dir on `sys.path`:

```python
#!/usr/bin/env python3
"""Standalone tests for the shared secret-rule registry (templates/floor/secret_rules.py).
Run: python3 docs/harness/secret_rules.test.py   (exit 0 = pass)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates", "floor"))
import secret_rules as sr  # noqa: E402

N = 0


def check(cond, msg):
    global N
    N += 1
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)


# --- crown-jewel signatures exist and match the canonical shapes ---
check(sr.PEM_PRIVATE_KEY.search("-----BEGIN PRIVATE KEY-----"), "PKCS#8 PEM matches")  <!-- pragma: allowlist secret -->
check(sr.PEM_PRIVATE_KEY.search("-----BEGIN RSA PRIVATE KEY-----"), "RSA PEM matches")  <!-- pragma: allowlist secret -->
check(sr.PEM_PRIVATE_KEY.search("-----BEGIN OPENSSH PRIVATE KEY-----"), "OPENSSH PEM matches")  <!-- pragma: allowlist secret -->
check(sr.GCP_SERVICE_ACCOUNT_TYPE.search('"type": "service_account"'), "GCP type marker matches")
check(sr.GCP_SERVICE_ACCOUNT_KEY.search('"private_key": "-----BEGIN'), "GCP private_key marker matches")  <!-- pragma: allowlist secret -->

# --- registry carries the named crown jewels + the other families ---
names = {n for n, _ in sr.RULES}
for expected in ("private-key", "gcp-sa-private-key", "aws-key-id",
                 "azure-account-key", "stripe-secret", "jwt"):
    check(expected in names, f"RULES registry includes {expected}")

# --- entropy-gated placeholder: the FIX for the len<=24 hole ---
# a LONG, high-entropy real secret that merely contains 'example' is NOT a placeholder
real = "AKfYcExample7Q3vN8sZpL2wR9tB4xM1kD6hJ0gF5nC7uQ"  # >24, high entropy, has 'Example'
check(not sr.is_placeholder(real), "long high-entropy value containing 'example' is NOT a placeholder")
# short obvious placeholder still excused
check(sr.is_placeholder("changeme"), "short 'changeme' is a placeholder")
check(sr.is_placeholder("your-token-here"), "'your-token-here' is a placeholder")
# trivially repetitive excused regardless of length
check(sr.is_placeholder("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"), "repetitive xxxx is a placeholder")
check(sr.is_placeholder("aaaa"), "<=2 distinct chars is a placeholder")
# entropy helper sanity
check(sr.shannon_entropy("aaaa") < 1.0, "repetitive string is low entropy")
check(sr.shannon_entropy(real) > 3.0, "real secret is high entropy")

print(f"ok - {N} assertions passed")
```

- [ ] 2. Run it — it FAILS (module does not exist yet):
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_rules.test.py`
   Expected: `ModuleNotFoundError: No module named 'secret_rules'`, exit 1.

- [ ] 3. Minimal impl: create `secret_rules.py` with this exact content:

```python
#!/usr/bin/env python3
"""secret_rules.py — the canonical credential-shape registry for the harness floor.

Single source of truth shared by:
  * secret-scan.py        (the floor scanner that runs blocking in CI / pre-commit)
  * docs/harness/scan.py  (the conformance verifier's content-signature check)

so the deployed scanner and the verifier that grades it can NEVER drift. No
dependencies, deterministic. FORMAT rules are high-confidence credential shapes and
are ALWAYS run (no placeholder filtering, no file-type skipping); the GENERIC rule is
a best-effort "secret = <value>" catch-most that IS placeholder/entropy filtered.

Phase-0 crown jewels (must always be detectable): PEM / PKCS#8 private keys and GCP
service-account JSON. Their patterns are exported by name so the verifier can assert a
repo's deployed scanner still carries them.
"""

import math
import re

# --- named Phase-0 crown-jewel signatures (verifier asserts these by name) ---
PEM_PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----"
)
# GCP service-account JSON: the type marker AND a private_key field (order-independent).
GCP_SERVICE_ACCOUNT_TYPE = re.compile(r'"type"\s*:\s*"service_account"')
GCP_SERVICE_ACCOUNT_KEY = re.compile(r'"private_key"\s*:\s*"-----BEGIN')

# --- the FORMAT registry: (name, compiled pattern). Always run, never filtered. ---
RULES = [
    ("private-key", PEM_PRIVATE_KEY),
    ("gcp-sa-private-key", GCP_SERVICE_ACCOUNT_KEY),
    ("aws-key-id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}")),
    ("slack-webhook", re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}")),
    ("github-token", re.compile(r"\bgh[posru]_[0-9A-Za-z]{36,}")),
    ("github-fine-pat", re.compile(r"\bgithub_pat_[0-9A-Za-z_]{60,}")),
    ("stripe-secret", re.compile(r"\b[rs]k_live_[0-9A-Za-z]{16,}")),
    ("stripe-test", re.compile(r"\bsk_test_[0-9A-Za-z]{16,}")),
    ("anthropic-key", re.compile(r"\bsk-ant-[0-9A-Za-z_-]{90,}")),
    ("openai-proj-key", re.compile(r"\bsk-proj-[0-9A-Za-z_-]{20,}")),
    ("azure-account-key", re.compile(r"AccountKey=[A-Za-z0-9+/=]{40,}")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
]

# --- generic "secret = <long quoted value>" — case-insensitive env-line keys ---
# Note: 'private[_-]?key' here catches `private_key = "..."` env-style lines; the PEM
# body itself is caught by PEM_PRIVATE_KEY regardless of any assignment.
GENERIC = re.compile(
    r"""(?ix) (secret|token|passwd|password|api[_-]?key|access[_-]?key
              |client[_-]?secret|auth[_-]?token|private[_-]?key)
        ["']? \s* [:=] \s* ["']([^"']{12,})["']"""
)

ALLOW = re.compile(r"(?:pragma:\s*allowlist secret|gitleaks:allow|nosecret)", re.I)
PLACEHOLDER = re.compile(
    r"(?i)(?:change[_-]?me|example|your[_-]|placeholder|redacted|dummy|sample|xxxx+|\.\.\.|"
    r"\$\{|\{\{|<[a-z]|^(?:null|none|true|false)$)"
)


def shannon_entropy(s):
    """Bits/char Shannon entropy. A real random secret scores high (>~3.0);
    a repetitive placeholder ('xxxxxxxx', 'aaaa') scores low."""
    if not s:
        return 0.0
    counts = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def is_placeholder(val, entropy_floor=3.0):
    """True if val looks like a non-secret placeholder.

    Hardened vs the old `len(v) <= 24` gate: a value is only treated as a placeholder
    when it ALSO reads as low-entropy. A long, high-entropy real secret that merely
    *contains* the word 'sample'/'example' is NOT dropped — it must clear the entropy
    floor to be excused. Trivially-repetitive values (<=2 distinct chars) stay excused.
    """
    v = val.strip()
    if len(set(v)) <= 2:
        return True
    looks_placeholder = bool(PLACEHOLDER.search(v))
    if not looks_placeholder:
        return False
    # Excuse only when it reads as a placeholder AND is short OR low-entropy. A long
    # high-entropy value that happens to contain a placeholder word is a real finding.
    return len(v) <= 24 or shannon_entropy(v) < entropy_floor
```

- [ ] 4. Run again — PASS:
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_rules.test.py`
   Expected: `ok - 17 assertions passed`, exit 0.

- [ ] 5. Commit: `floor: add shared secret_rules registry with entropy-gated placeholder filter`

---

## Task A2 — harden `secret-scan.py` (import RULES; format-scan ALL files; `errors="replace"`; entropy gate)

**Files**
- modify `/home/ilaaj-agent/homelab-infra/docs/harness/templates/floor/secret-scan.py`
- create test `/home/ilaaj-agent/homelab-infra/docs/harness/secret_scan.test.py`

**Interfaces** — consumes: `secret_rules.RULES`, `secret_rules.GENERIC`, `secret_rules.ALLOW`, `secret_rules.is_placeholder` (via sibling `sys.path` shim). produces: `main(argv)` exit codes (`0` clean, `1` findings, `2` bad input), `scannable(path)`, `tracked_files()`.

**Steps**

- [ ] 1. Write the failing test (lives in `docs/harness/`, writes a temp tree, invokes the floor scanner via subprocess so it exercises the real shim + exit codes):

```python
#!/usr/bin/env python3
"""Standalone tests for the floor secret scanner (templates/floor/secret-scan.py).
Run: python3 docs/harness/secret_scan.test.py   (exit 0 = pass)."""
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCANNER = os.path.join(HERE, "templates", "floor", "secret-scan.py")
N = 0


def check(cond, msg):
    global N
    N += 1
    if not cond:
        print(f"FAIL: {msg}")
        sys.exit(1)


def run(path):
    """Run the scanner against one explicit path; return its exit code + stdout."""
    p = subprocess.run([sys.executable, SCANNER, path], capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


GCP_SA = (
    '{\n  "type": "service_account",\n'
    '  "private_key": "-----BEGIN PRIVATE KEY-----\\nMIIabc123\\n-----END PRIVATE KEY-----\\n"\n}\n'  <!-- pragma: allowlist secret -->
)
PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n"  <!-- pragma: allowlist secret -->

with tempfile.TemporaryDirectory() as tmp:
    # 1. a PEM in a NORMAL file is caught
    f = os.path.join(tmp, "key.txt")
    open(f, "w").write(PEM)
    rc, out = run(f)
    check(rc == 1, "PEM private key in a normal file is a finding")

    # 2. THE FIX: a service-account JSON in an .example file is STILL format-scanned
    fx = os.path.join(tmp, "service-account.json.example")
    open(fx, "w").write(GCP_SA)
    rc, out = run(fx)
    check(rc == 1, ".example file with a GCP service_account key is a finding (format rules ignore skip)")
    check("gcp-sa-private-key" in out or "private-key" in out, "names the GCP/PEM rule")

    # 3. THE FIX: a PEM inside a lockfile is still caught
    lf = os.path.join(tmp, "pnpm-lock.yaml")
    open(lf, "w").write("lockfileVersion: 9\n" + PEM)
    rc, out = run(lf)
    check(rc == 1, "PEM inside a lockfile is a finding (format rules ignore SKIP_NAMES)")

    # 4. THE FIX: a file with an undecodable byte is NOT silently skipped (errors='replace')
    fb = os.path.join(tmp, "weird.env")
    with open(fb, "wb") as fh:
        fh.write(b"API_KEY = '")
        fh.write(b"\xff\xfe")  # invalid utf-8
        fh.write(PEM.encode() + b"'\n")
    rc, out = run(fb)
    check(rc == 1, "a file with a bad byte is still scanned (no silent skip), PEM caught")

    # 5. entropy gate: long high-entropy assignment containing 'example' is a finding
    fe = os.path.join(tmp, "conf.yaml")
    open(fe, "w").write('api_key: "AKfYcExample7Q3vN8sZpL2wR9tB4xM1kD6hJ0gF5nC7uQ"\n')  <!-- pragma: allowlist secret -->
    rc, out = run(fe)
    check(rc == 1, "long high-entropy secret containing 'example' is a finding (entropy gate)")

    # 6. a genuine short placeholder is still clean (no false positive)
    fp = os.path.join(tmp, "ok.env")
    open(fp, "w").write('PASSWORD = "changeme"\n')
    rc, out = run(fp)
    check(rc == 0, "short 'changeme' placeholder is clean")

    # 7. a clean file is clean
    fc = os.path.join(tmp, "clean.txt")
    open(fc, "w").write("hello world\n")
    rc, out = run(fc)
    check(rc == 0, "clean file exits 0")

print(f"ok - {N} assertions passed")
```

- [ ] 2. Run it — FAILS (current scanner skips `.example`, skips lockfiles, uses `errors="strict"` so the bad-byte file is skipped, and the entropy gate doesn't exist):
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_scan.test.py`
   Expected: first failure at assertion 2 — `FAIL: .example file with a GCP service_account key is a finding ...`, exit 1.

- [ ] 3. Minimal impl in `templates/floor/secret-scan.py`:
   - Add the sibling-import shim near the top and import the registry; delete the inline `ALLOW`/`PLACEHOLDER`/`is_placeholder`/`RULES`/`GENERIC` (now sourced from `secret_rules`):
     ```python
     import os
     import re  # still used by tracked_files-adjacent helpers / redact
     import subprocess
     import sys

     sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
     from secret_rules import RULES, GENERIC, ALLOW, is_placeholder  # noqa: E402
     ```
   - Split skip logic so FORMAT rules run on **all** text files. Keep `SKIP_SUFFIX` only for binary/asset types; do NOT skip `.example`/`.sample` or lockfiles for format rules. Concretely, `scannable()` keeps the binary-asset suffix skip and drops the `.example`/`.sample` and `SKIP_NAMES` early-returns; instead introduce a `generic_excluded(path)` predicate so lockfiles/example files run RULES but skip the noisy GENERIC rule:
     ```python
     SKIP_SUFFIX = (".min.js", ".min.css", ".map", ".svg", ".png", ".jpg",
                    ".jpeg", ".gif", ".ico", ".pdf", ".woff", ".woff2", ".ttf")
     GENERIC_SKIP_SUFFIX = (".lock",)
     GENERIC_SKIP_NAMES = {"package-lock.json", "pnpm-lock.yaml", "yarn.lock",
                           "bun.lock", "Cargo.lock", "poetry.lock"}

     def scannable(path):
         # binary/asset files never have scannable text; the scanner's own source is excluded
         if os.path.basename(path) == "secret-scan.py" or path.endswith(SKIP_SUFFIX):
             return False
         return True  # FORMAT rules run on EVERYTHING else, incl .example / .sample

     def generic_excluded(path):
         """Lockfiles / generated files: run FORMAT rules but suppress the noisy GENERIC rule."""
         name = os.path.basename(path)
         return name in GENERIC_SKIP_NAMES or path.endswith(GENERIC_SKIP_SUFFIX)
     ```
   - In the `main()` loop, change `errors="strict"` → `errors="replace"` and drop `UnicodeDecodeError` from the skip clause (only `OSError` skips a truly unreadable file):
     ```python
     try:
         with open(path, "r", encoding="utf-8", errors="replace") as f:
             lines = f.readlines()
     except OSError:
         continue  # unreadable — skip (a decodable-with-replacement file is still scanned)
     ```
     and gate only the GENERIC rule:
     ```python
     g = GENERIC.search(line)
     if g and not generic_excluded(path) and not is_placeholder(g.group(2)):
         findings.append((path, n, f"secret-assignment ({g.group(1)})", redact(g.group(2))))
     ```

- [ ] 4. Run again — PASS:
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_scan.test.py`
   Expected: `ok - 8 assertions passed`, exit 0.
   Also re-run the registry test to confirm no regression: `python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_rules.test.py` → `ok - 17 assertions passed`.

- [ ] 5. Commit: `floor: secret-scan runs format rules on all files (incl .example/lockfiles), decode errors=replace, entropy-gated generic filter`

---

## Task A3 — propagate the new module via `init.py` (copy `secret_rules.py` + the import shim)

**Files**
- modify `/home/ilaaj-agent/homelab-infra/docs/harness/init.py` (add a copy step in `build_plan()`)
- modify `/home/ilaaj-agent/homelab-infra/docs/harness/init.test.py` (assert the new file lands)

**Interfaces** — consumes: `FLOOR/secret_rules.py`. produces: `repo/scripts/secret_rules.py` alongside `repo/scripts/secret-scan.py` (the shim `sys.path.insert(0, dirname(__file__))` already resolves the sibling at runtime in any repo).

**Steps**

- [ ] 1. Add a failing assertion to `init.test.py` inside the existing `--apply` block (after the existing created-files loop), extending the created-files list:
   ```python
   for rel in ("AGENTS.md", "scripts/secret-scan.py", "scripts/secret_rules.py",
               ".githooks/pre-push", ".githooks/pre-commit", ".githooks/commit-msg",
               ".github/workflows/check.yml", ".harness.yml"):
       check(os.path.exists(os.path.join(tmp, rel)), f"created {rel}")
   ```
   and add a behavioral check that the propagated scanner actually catches a PEM in a fresh repo:
   ```python
   open(os.path.join(tmp, "leak.txt"), "w").write(
       "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----\n")  <!-- pragma: allowlist secret -->
   sc = subprocess.run([sys.executable, os.path.join(tmp, "scripts", "secret-scan.py"),
                        os.path.join(tmp, "leak.txt")], capture_output=True, text=True)
   check(sc.returncode == 1, "propagated scanner imports secret_rules and catches a PEM")
   ```

- [ ] 2. Run it — FAILS (init copies only `secret-scan.py`; `scripts/secret_rules.py` is absent so the propagated scanner's import errors → nonzero for the wrong reason, and the `created scripts/secret_rules.py` assertion fails first):
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/init.test.py`
   Expected: `FAIL: created scripts/secret_rules.py`, exit 1.

- [ ] 3. Minimal impl in `init.py build_plan()`, right after the secret-scan step (the existing block that adds `scripts/secret-scan.py`):
   ```python
   # 2b. shared secret-rule registry (imported by secret-scan.py via its sibling shim)
   sr = os.path.join("scripts", "secret_rules.py")
   add("secret-rules", sr, os.path.exists(os.path.join(repo, sr)),
       lambda: _copy(os.path.join(FLOOR, "secret_rules.py"), os.path.join(repo, sr)))
   ```
   (No package `__init__.py` needed: `secret-scan.py`'s `sys.path.insert(0, dirname(__file__))` shim already resolves `secret_rules` from the same `scripts/` dir.)

- [ ] 4. Run again — PASS:
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/init.test.py`
   Expected: `ok - <N> assertions passed`, exit 0.

- [ ] 5. Commit: `init: propagate secret_rules.py into scripts/ so the floor scanner imports the shared registry`

---

## Task A4 — harden `scan.py assess()` (isfile + non-empty evidence; fail-closed on bad level; PEM + service_account content-signature per enforcers pillar)

**Files**
- modify `/home/ilaaj-agent/homelab-infra/docs/harness/scan.py` (`assess()`, lines 93-129)
- modify `/home/ilaaj-agent/homelab-infra/docs/harness/scan.test.py` (add stub-evidence + fail-closed + content-signature cases; fix the pre-existing empty-`R.md` fixture — see note below)

**Interfaces** — consumes: `secret_rules.PEM_PRIVATE_KEY`, `secret_rules.GCP_SERVICE_ACCOUNT_TYPE`, `secret_rules.GCP_SERVICE_ACCOUNT_KEY` (imported via the floor template path); a repo's `.harness.yml` + on-disk evidence. produces: the `assess()` result dict with hardened `unverified[]` and a fail-closed `cells` value for unknown level strings.

> **Pre-existing-test note (must be done inside this task's commit):** the existing `scan.test.py` `good` case uses an empty `open(...,"w").close()` `R.md` as evidence for several `L2` pillars. Under the hardened `_is_real_file` (non-empty) rule, that fixture would newly flag as unverified. Step 3 below therefore **also** updates that fixture to write a non-empty `R.md` (e.g. `open(os.path.join(good, "R.md"), "w").write("evidence\n")`) — this is a required test-fixture fix, not a behavior regression. The `enforcers` pillar in that fixture points at `R.md` (not a `secret-scan.py`), so the crown-jewel content check is correctly skipped for it (the `scanners` list is empty).

**Steps**

- [ ] 1. Add failing tests to `scan.test.py` inside the existing `tempfile.TemporaryDirectory()` block:

```python
    # --- stub-evidence hole: an EMPTY evidence file must NOT satisfy a >=L2 claim ---
    stub = write_repo(
        os.path.join(tmp, "stub"),
        "archetype: gui-app\n"
        "levels: {context: L2, legibility: L2, enforcers: L2, verification: L2, gc: L1, autonomy: L2}\n"
        "evidence: {context: [E.md], legibility: [E.md], enforcers: [E.md],"
        " verification: [E.md], autonomy: [E.md]}\n",
    )
    open(os.path.join(stub, "E.md"), "w").close()  # zero-byte stub
    rs = scan.assess(stub, targets)
    check(any("context" in u for u in rs["unverified"]),
          "a zero-byte evidence file must NOT satisfy a >=L2 claim")
    check(not rs["conformant"], "stub-evidence repo is not conformant")

    # --- a DIRECTORY named like the evidence file must not satisfy it either ---
    dstub = write_repo(
        os.path.join(tmp, "dstub"),
        "archetype: gui-app\n"
        "levels: {enforcers: L2, context: L1, legibility: L1, verification: L1, gc: L1, autonomy: L1}\n"
        "evidence: {enforcers: [scripts]}\n",
    )
    os.makedirs(os.path.join(dstub, "scripts"))
    rd = scan.assess(dstub, targets)
    check(any("enforcers" in u for u in rd["unverified"]),
          "a directory does not count as a file evidence")

    # --- fail-closed: an unknown level string (l3 / L9) must NOT bypass verification ---
    bad = write_repo(
        os.path.join(tmp, "bad"),
        "archetype: gui-app\n"
        "levels: {context: L9, legibility: l3, enforcers: L0, verification: L0, gc: L0, autonomy: L0}\n"
        "evidence: {}\n",
    )
    rb = scan.assess(bad, targets)
    check(any("context" in u for u in rb["unverified"]) or "context" in str(rb.get("cells")),
          "an unknown level string (L9) is flagged, never silently treated as below-L2")
    check(not rb["conformant"], "a repo with an unparseable level string is not conformant")

    # --- content-signature: enforcers L2 evidence must actually defend PEM + service_account ---
    sig = write_repo(
        os.path.join(tmp, "sig"),
        "archetype: gui-app\n"
        "levels: {enforcers: L2, context: L1, legibility: L1, verification: L1, gc: L1, autonomy: L1}\n"
        "evidence: {enforcers: [scripts/secret-scan.py]}\n",
    )
    os.makedirs(os.path.join(sig, "scripts"))
    open(os.path.join(sig, "scripts", "secret-scan.py"), "w").write("print('not a real scanner')\n")
    rg = scan.assess(sig, targets)
    check(any("enforcers" in u for u in rg["unverified"]),
          "enforcers L2 with a scanner missing the PEM/service_account signatures is unverified")
```

- [ ] 2. Run it — FAILS (current `assess()` uses `os.path.exists`, so the zero-byte file and the directory both pass; `ORDER.get(actual, 0)` returns 0 for `L9`/`l3` so they bypass; no content-signature check):
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/scan.test.py`
   Expected: `FAIL: a zero-byte evidence file must NOT satisfy a >=L2 claim`, exit 1.

- [ ] 3. Minimal impl in `scan.py`:
   - Import the shared signatures (the floor template dir is the source of truth):
     ```python
     sys.path.insert(0, os.path.join(HERE, "templates", "floor"))
     from secret_rules import (PEM_PRIVATE_KEY, GCP_SERVICE_ACCOUNT_TYPE,  # noqa: E402
                               GCP_SERVICE_ACCOUNT_KEY)
     ```
   - Add a fail-closed level rank + a content-signature helper:
     ```python
     def _rank(level):
         """Numeric rank for a level string; UNKNOWN strings fail CLOSED (return None)
         so an l3/L9 typo or fabrication can never bypass the >=L2 evidence check."""
         return ORDER.get(level)  # None for anything not in {L0,L1,L2,L3}

     def _is_real_file(repo, rel):
         p = os.path.join(repo, rel)
         return os.path.isfile(p) and os.path.getsize(p) > 0

     def _defends_crown_jewels(repo, rel):
         """True iff the named enforcers evidence file (a secret scanner) actually carries
         the PEM + GCP service-account signatures — or imports the shared registry that does."""
         p = os.path.join(repo, rel)
         try:
             with open(p, "r", encoding="utf-8", errors="replace") as f:
                 text = f.read()
         except OSError:
             return False
         if "secret_rules" in text:  # imports the canonical registry → defends by construction
             return True
         has_pem = bool(PEM_PRIVATE_KEY.search(text)) or "PRIVATE KEY" in text
         has_gcp = (bool(GCP_SERVICE_ACCOUNT_KEY.search(text))
                    or bool(GCP_SERVICE_ACCOUNT_TYPE.search(text))
                    or "service_account" in text)
         return has_pem and has_gcp
     ```
   - Rewrite the per-pillar block (replacing lines 110-123). Treat an unknown `actual` as a verification failure (flag `?`) and never gap-skip it; require **non-empty file** evidence; for the `enforcers` pillar additionally require the secret-scan evidence to defend the crown jewels:
     ```python
     for p in PILLARS:
         actual = str(levels.get(p, "?"))
         tgt = str(target.get(p, "L0"))
         flag = ""
         a_rank, t_rank = _rank(actual), _rank(tgt)
         # Gap: actual below the archetype target (only when actual is a known level).
         if a_rank is not None and t_rank is not None and a_rank < t_rank:
             flag = "▼"
             gaps.append(f"{name}: {p} {actual} < target {tgt}")
         # Fail-closed: an unparseable level string is never trusted.
         if a_rank is None:
             flag = (flag + "?") if flag else "?"
             unverified.append(f"{name}: {p} has unrecognised level {actual!r}")
         # Honest-numbers: a claim of >= L2 needs NON-EMPTY FILE evidence on disk.
         elif a_rank >= 2:
             ev = evidence.get(p) or []
             missing = [e for e in ev if not _is_real_file(repo, e)]
             reasons = []
             if not ev:
                 reasons.append("no evidence listed")
             elif missing:
                 reasons.append("missing/empty: " + ", ".join(missing))
             # Crown-jewel content signature on the enforcers pillar's secret scanner.
             if p == "enforcers" and ev and not missing:
                 scanners = [e for e in ev if e.endswith("secret-scan.py")]
                 if scanners and not any(_defends_crown_jewels(repo, s) for s in scanners):
                     reasons.append("secret-scan present but missing PEM/service_account signatures")
             if reasons:
                 flag = (flag + "?") if flag else "?"
                 unverified.append(f"{name}: {p} claims {actual} but " + "; ".join(reasons))
         cells[p] = actual + flag
     ```
   - Also update the pre-existing `good` fixture in `scan.test.py` to write a non-empty `R.md` (see the pre-existing-test note above).

- [ ] 4. Run again — PASS (new + all pre-existing scan.test.py assertions):
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/scan.test.py`
   Expected: `ok - <N> assertions passed`, exit 0.
   Re-run the full Part A suite to confirm no cross-file regression:
   `python3 /home/ilaaj-agent/homelab-infra/docs/harness/init.test.py && python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_rules.test.py && python3 /home/ilaaj-agent/homelab-infra/docs/harness/secret_scan.test.py && python3 /home/ilaaj-agent/homelab-infra/docs/harness/scan.test.py`
   Expected: each prints `ok - N assertions passed`, all exit 0.

- [ ] 5. Commit: `scan: assess() requires non-empty file evidence, fails closed on unknown level strings, and verifies the enforcers secret-scan defends PEM/service_account signatures`

> **End of Part A:** push the branch over SSH, hand over the create-PR URL, human merges. Do not start Part B against the registry until Part A is merged (Part B vendors A's `secret_rules.py` and CI-pins it to A's `registry_digest()`).

---

# Part B — nanoclaw-v2 (scrub-payload.py egress floor)

> Part B vendors a byte-identical copy of Part A's registry into nanoclaw (cross-repo import is impossible: separate repos, RO bind-mount, homelab-infra not in the container image) and pins it with a drift test. All work in a worktree off `nanoclaw-v2` `main`; nanoclaw-v2 is a deploy checkout → worktree, branch, PR, human merges, return checkout to `main`. `scripts/` is bind-mounted RO at `/app/scripts` (no image rebuild for script-only changes). Prettier `format:check` only touches `src/**/*.ts`, so `.py` files have no formatting gate. CI runs each `test_*.py` directly with `python3`.

Run commands (from `container/agent-runner/`):
```
python3 scripts/test_scrub_payload.py
python3 scripts/test_secret_rules_pin.py
```

## Task B5.0 — Vendor the registry + compute the pin

**Files**
- create `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/secret_rules.py`
- create `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_secret_rules_pin.py`

**Interfaces** — consumes: Part A's canonical `secret_rules.py` (via `SECRET_RULES_CANONICAL` env in CI). produces: vendored `RULES`, `GENERIC`, `ALLOW`, `is_placeholder`, `registry_digest()`, `REGISTRY_SHA256`.

**Steps**

- [ ] 1. Write failing test `test_secret_rules_pin.py`:
   ```python
   #!/usr/bin/env python3
   """Pin: vendored secret_rules must not drift from itself or the canonical floor."""
   import hashlib, importlib.util, os, sys
   from pathlib import Path

   _HERE = Path(__file__).resolve().parent
   _spec = importlib.util.spec_from_file_location('secret_rules', _HERE / 'secret_rules.py')
   secret_rules = importlib.util.module_from_spec(_spec)
   sys.modules['secret_rules'] = secret_rules
   _spec.loader.exec_module(secret_rules)

   import unittest


   class RegistryPin(unittest.TestCase):
       def test_self_consistent_digest(self):
           # the pinned constant must equal the digest of the live RULES
           self.assertEqual(secret_rules.REGISTRY_SHA256, secret_rules.registry_digest())

       def test_matches_canonical_when_present(self):
           # CI exports SECRET_RULES_CANONICAL=path to homelab-infra floor module
           canon = os.environ.get('SECRET_RULES_CANONICAL')
           if not canon or not os.path.isfile(canon):
               self.skipTest('canonical floor module not available')
           cspec = importlib.util.spec_from_file_location('canon_rules', canon)
           cmod = importlib.util.module_from_spec(cspec)
           cspec.loader.exec_module(cmod)
           self.assertEqual(secret_rules.registry_digest(), cmod.registry_digest())

       def test_covers_phase0_leak_shapes(self):
           names = {n for n, _ in secret_rules.RULES}
           for need in ('private-key', 'gcp-sa-private-key', 'aws-key-id',
                        'azure-account-key', 'stripe-secret', 'github-fine-pat'):
               self.assertIn(need, names)


   if __name__ == '__main__':
       unittest.main()
   ```

- [ ] 2. Run it — FAILS: `python3 scripts/test_secret_rules_pin.py` → `ModuleNotFoundError` / `secret_rules.py` missing.

- [ ] 3. Minimal impl: create `scripts/secret_rules.py` with this exact content:

```python
#!/usr/bin/env python3
"""secret_rules — VENDORED secret-format registry. DO NOT EDIT BY HAND.

Canonical source: homelab-infra `docs/harness/templates/floor/secret_rules.py`
(the harness floor's secret-scan registry, PART A). This file is a byte-identical
vendored copy because nanoclaw-v2 (a public mirror, run inside an air-gapped
container) cannot import across the homelab-infra repo boundary.

Drift is caught two ways:
  - nanoclaw side: scripts/test_secret_rules_pin.py asserts our REGISTRY_SHA256
    matches the sha256 of our own normalized RULES (self-consistency) AND, when
    SECRET_RULES_CANONICAL is set in CI, that it equals the canonical file's sha.
  - homelab-infra side (PART A): the floor's pin test asserts the same constant.

To update: change the canonical file, run its emit-sha helper, copy the new
REGISTRY_SHA256 and the new RULES here verbatim, re-run both pin tests.
"""

import hashlib
import re

# ALLOW / PLACEHOLDER / is_placeholder are carried so the scrubber's generic
# assignment rule behaves identically to the floor scanner.
ALLOW = re.compile(r"(?:pragma:\s*allowlist secret|gitleaks:allow|nosecret)", re.I)
PLACEHOLDER = re.compile(
    r"(?i)(?:change[_-]?me|example|your[_-]|placeholder|redacted|dummy|sample|xxxx+|\.\.\.|"
    r"\$\{|\{\{|<[a-z]|^(?:null|none|true|false)$)"
)


def is_placeholder(val):
    v = val.strip()
    return (bool(PLACEHOLDER.search(v)) and len(v) <= 24) or len(set(v)) <= 2


# (name, compiled pattern). Byte-identical to the canonical floor RULES.
RULES = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----")),
    ("aws-key-id", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("gcp-sa-private-key", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
    ("slack-token", re.compile(r"\bxox[baprs]-[0-9A-Za-z-]{10,}")),
    ("slack-webhook", re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/_-]{20,}")),
    ("github-token", re.compile(r"\bgh[posru]_[0-9A-Za-z]{36,}")),
    ("github-fine-pat", re.compile(r"\bgithub_pat_[0-9A-Za-z_]{60,}")),
    ("stripe-secret", re.compile(r"\b[rs]k_live_[0-9A-Za-z]{16,}")),
    ("stripe-test", re.compile(r"\bsk_test_[0-9A-Za-z]{16,}")),
    ("anthropic-key", re.compile(r"\bsk-ant-[0-9A-Za-z_-]{90,}")),
    ("openai-proj-key", re.compile(r"\bsk-proj-[0-9A-Za-z_-]{20,}")),
    ("azure-account-key", re.compile(r"AccountKey=[A-Za-z0-9+/=]{40,}")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")),
]

GENERIC = re.compile(
    r"""(?ix) (secret|token|passwd|password|api[_-]?key|access[_-]?key
              |client[_-]?secret|auth[_-]?token|private[_-]?key)
        ["']? \s* [:=] \s* ["']([^"']{12,})["']"""
)


def registry_digest():
    """Stable sha256 over the registry's *semantic* content (name + pattern
    source), independent of formatting/comments. Both consumers compute this
    the same way so the pin compares apples to apples."""
    h = hashlib.sha256()
    for name, pat in RULES:
        h.update(name.encode("utf-8"))
        h.update(b"\x00")
        h.update(pat.pattern.encode("utf-8"))
        h.update(b"\x00")
    h.update(b"GENERIC\x00")
    h.update(GENERIC.pattern.encode("utf-8"))
    return h.hexdigest()


# Pin: must equal registry_digest(). Updated only when the canonical registry
# changes (and PART A's floor pin is updated in lockstep). The literal below is
# computed by `python3 -c "import secret_rules as s; print(s.registry_digest())"`.
REGISTRY_SHA256 = "<filled in step 3 below — computed, not guessed>"
```

   Then compute the pin and replace the `REGISTRY_SHA256` literal with the real value:
   `python3 -c "import importlib.util as u,pathlib as p; s=u.spec_from_file_location('r', p.Path('scripts/secret_rules.py')); m=u.module_from_spec(s); s.loader.exec_module(m); print(m.registry_digest())"`

   > The shipped code carries a real computed digest, NOT the `<…>` marker — that marker only shows where the computed digest lands.

   > **Canonical-pin caveat:** Part A's `registry_digest()` includes the `stripe-test`, `anthropic-key`, `openai-proj-key`, `google-api-key`, `slack-*`, `jwt`, `github-*` rules and the same `GENERIC` pattern. The vendored RULES list above must be byte-identical (same names, same pattern sources, same order) to Part A's so `test_matches_canonical_when_present` passes in CI. If Part A's final merged `secret_rules.py` differs in any pattern, re-vendor verbatim from the merged Part A file before computing the pin. (Note Part A's RULES orders `gcp-sa-private-key` second; this vendored copy must match Part A's final order exactly — copy from the merged file, do not hand-reorder.)

- [ ] 4. Run it — PASS: `python3 scripts/test_secret_rules_pin.py` → OK (`test_matches_canonical_when_present` skips locally, runs in CI). Wire `SECRET_RULES_CANONICAL` into the nanoclaw CI test job so the canonical-equality assertion runs against the merged Part A floor module path.

- [ ] 5. Commit: `floor: vendor shared secret_rules registry into scrub-payload (+ drift pin)`

---

## Task B5.1 — PEM / PKCS#8 private key now redacted (the core refactor)

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/scrub-payload.py`
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`

**Interfaces** — consumes: `secret_rules.RULES`, `secret_rules.GENERIC`, `secret_rules.ALLOW`, `secret_rules.is_placeholder` (loaded via `importlib` anchored to `Path(__file__).parent`). produces: a `tokens_by_prefix` list derived from `secret_rules.RULES`, a `generic_assignment` rule in `scrub_string`.

**Steps**

- [ ] 1. Write failing test (new class in `test_scrub_payload.py`):
   ```python
   class PrivateKeyScrubbing(unittest.TestCase):
       def test_pkcs8_begin_redacted(self):
           out = fresh().scrub_string('key: -----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----')  <!-- pragma: allowlist secret -->
           self.assertNotIn('BEGIN PRIVATE KEY', out)
           self.assertIn('[redacted:token-', out)

       def test_rsa_begin_redacted(self):
           out = fresh().scrub_string('-----BEGIN RSA PRIVATE KEY-----')  <!-- pragma: allowlist secret -->
           self.assertNotIn('BEGIN RSA PRIVATE KEY', out)

       def test_openssh_begin_redacted(self):
           out = fresh().scrub_string('-----BEGIN OPENSSH PRIVATE KEY-----')  <!-- pragma: allowlist secret -->
           self.assertNotIn('BEGIN OPENSSH PRIVATE KEY', out)
   ```

- [ ] 2. Run it — FAILS: `python3 scripts/test_scrub_payload.py` → PEM marker survives (no rule today).

- [ ] 3. Minimal impl — apply the registry refactor to `scrub-payload.py`. Replace the `import` block:
   ```python
   import json
   import re
   import sys
   from dataclasses import dataclass, field
   ```
   with:
   ```python
   import json
   import re
   import sys
   from dataclasses import dataclass, field
   from pathlib import Path

   # Vendored shared registry (one registry, two consumers). Loaded the same
   # importlib way the tests load this script, so a hyphenated sibling never bites
   # us and the import works regardless of cwd (container spawns us at
   # /app/scripts/scrub-payload.py).
   import importlib.util as _il

   _RULES_PATH = Path(__file__).resolve().parent / 'secret_rules.py'
   _rspec = _il.spec_from_file_location('secret_rules', _RULES_PATH)
   secret_rules = _il.module_from_spec(_rspec)
   sys.modules['secret_rules'] = secret_rules
   _rspec.loader.exec_module(secret_rules)
   ```
   In `_build_string_patterns` replace the hardcoded token list with registry-derived rules:
   ```python
       # Token / credential shapes — DERIVED from the shared vendored registry
       # (secret_rules.RULES) so the scrubber and the floor secret-scanner never
       # disagree on what a secret looks like. Anthropic's sk-ant- specificity is
       # preserved because RULES lists it before any generic sk- shape and the
       # scrub loop is order-preserving.
       tokens_by_prefix = [pat for _name, pat in secret_rules.RULES]

       # Generic placeholder-filtered "secret = <quoted long value>" — same rule
       # the floor uses. Unlike the env-var-line rule below it is case-insensitive
       # and works inside free-text strings (closes the lowercase-in-string hole).
       generic_assignment = secret_rules.GENERIC
   ```
   Update `scrub_string` to honor `ALLOW` and run the generic-assignment rule (value group only, placeholder-filtered):
   ```python
       def scrub_string(self, raw: str) -> str:
           if secret_rules.ALLOW.search(raw):
               # honor inline allowlist pragmas exactly like the floor scanner so a
               # deliberately-shared example value isn't tokenized in review text.
               allow_lines = True
           else:
               allow_lines = False

           def env_sub(match: re.Match[str]) -> str:
               key_part, value_part = match.group(1), match.group(2)
               return key_part + self._allocate(value_part, _CATEGORY_ENV_VALUE)

           def generic_sub(match: re.Match[str]) -> str:
               keyword, value = match.group(1), match.group(2)
               if secret_rules.is_placeholder(value):
                   return match.group(0)  # obvious placeholder — leave as-is
               return match.group(0).replace(value, self._allocate(value, _CATEGORY_ENV_VALUE), 1)

           out = _ENV_VAR_LINE_RE.sub(env_sub, raw)
           if not allow_lines:
               out = secret_rules.GENERIC.sub(generic_sub, out)
           for category, pattern in _STRING_PATTERNS:
               out = pattern.sub(lambda m, c=category: self._allocate(m.group(0), c), out)
           return out
   ```

- [ ] 4. Run it — PASS: `python3 scripts/test_scrub_payload.py` → OK.

- [ ] 5. Commit: `scrub: redact PEM/PKCS8 private keys via shared registry`

---

## Task B5.2 — GCP SA `private_key` in free-text JSON redacted (regression pin)

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`
- (impl covered by B5.1's registry-derived list)

**Interfaces** — consumes: `secret_rules.RULES` `gcp-sa-private-key` rule. produces: regression coverage for inline SA blobs.

**Steps**

- [ ] 1. Write failing test:
   ```python
   class GcpServiceAccountScrubbing(unittest.TestCase):
       def test_sa_private_key_in_blob_redacted(self):
           blob = ('the SA is {"type":"service_account",'
                   '"private_key":"-----BEGIN PRIVATE KEY-----MIIE","client_email":"x@y"}')  <!-- pragma: allowlist secret -->
           out = fresh().scrub_string(blob)
           self.assertNotIn('"private_key":"-----BEGIN', out)  <!-- pragma: allowlist secret -->
           self.assertIn('[redacted:token-', out)
   ```

- [ ] 2. Run it — FAILS if B5.1 not yet applied (free-text JSON string never reaches the dict walker; no `gcp-sa-private-key` string rule before refactor): `python3 scripts/test_scrub_payload.py`.

- [ ] 3. Minimal impl — covered by the registry-derived list (`gcp-sa-private-key` rule from B5.1); keep this test as a regression pin. No new code.

- [ ] 4. Run it — PASS: `python3 scripts/test_scrub_payload.py` → OK.

- [ ] 5. Commit: `scrub: redact inline GCP SA private_key blobs (regression pin)`

---

## Task B5.3 — AWS / Azure / Stripe / GH-fine-PAT / Google API key (regression pins)

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`
- (impl covered by B5.1's registry-derived list)

**Interfaces** — consumes: `secret_rules.RULES` `aws-key-id`, `azure-account-key`, `stripe-secret`, `github-fine-pat`, `google-api-key` rules. produces: regression coverage for the cloud-provider leak set.

**Steps**

- [ ] 1. Write failing tests:
   ```python
   class CloudProviderSecretScrubbing(unittest.TestCase):
       def test_aws_akia_redacted(self):
           out = fresh().scrub_string('id AKIAIOSFODNN7EXAMPLE here')  # pragma: allowlist secret
           self.assertNotIn('AKIAIOSFODNN7EXAMPLE', out)  <!-- pragma: allowlist secret -->
       def test_azure_account_key_redacted(self):
           out = fresh().scrub_string('AccountKey=' + 'A' * 44 + ';')
           self.assertNotIn('A' * 44, out)
       def test_stripe_live_redacted(self):
           out = fresh().scrub_string('charge sk_live_abcdef0123456789ABCDEF done')  <!-- pragma: allowlist secret -->
           self.assertNotIn('sk_live_abcdef0123456789ABCDEF', out)  <!-- pragma: allowlist secret -->
       def test_github_fine_pat_redacted(self):
           out = fresh().scrub_string('tok github_pat_' + 'A' * 62 + ' set')
           self.assertNotIn('github_pat_' + 'A' * 62, out)
       def test_google_api_key_redacted(self):
           out = fresh().scrub_string('key AIza' + 'B' * 35 + ' used')
           self.assertNotIn('AIza' + 'B' * 35, out)
   ```
   (Note: the `AKIA…EXAMPLE` test line carries `# pragma: allowlist secret` so the floor secret-scan doesn't flag the test file itself. Because `scrub_string` honors `ALLOW`, an inline pragma on the *scrubbed input* would suppress redaction — so the `# pragma` here is a *Python comment* on the test source line, NOT part of the `raw` string passed to `scrub_string`; keep it as a trailing code comment, not inside the string literal. The string `'id AKIAIOSFODNN7EXAMPLE here'` contains no pragma, so redaction is asserted correctly.)

- [ ] 2. Run it — FAILS if B5.1 not yet applied (none of these shapes exist pre-refactor): `python3 scripts/test_scrub_payload.py`.

- [ ] 3. Minimal impl — registry-derived (already in place after B5.1); pure regression pins. No new code.

- [ ] 4. Run it — PASS: `python3 scripts/test_scrub_payload.py` → OK.

- [ ] 5. Commit: `scrub: redact AWS/Azure/Stripe/GH-fine-PAT/Google keys via registry`

---

## Task B5.4 — lowercase free-text assignment redacted

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/scrub-payload.py`
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`

**Interfaces** — consumes: `secret_rules.GENERIC`, `secret_rules.is_placeholder`. produces: `generic_sub` handling inside `scrub_string`.

**Steps**

- [ ] 1. Write failing test:
   ```python
   class GenericAssignmentScrubbing(unittest.TestCase):
       def test_lowercase_password_in_text_redacted(self):
           out = fresh().scrub_string('config has password = "hunter2hunter2"')
           self.assertNotIn('hunter2hunter2', out)
           self.assertIn('[redacted:envval-', out)
       def test_placeholder_value_NOT_redacted(self):
           out = fresh().scrub_string('password = "changeme"')
           self.assertIn('changeme', out)  # placeholder filter keeps it
   ```

- [ ] 2. Run it — FAILS (uppercase-anchored env rule misses lowercase in-string; no generic rule): `python3 scripts/test_scrub_payload.py`.

- [ ] 3. Minimal impl — the `generic_sub` + `secret_rules.GENERIC.sub` block in `scrub_string` (already added in B5.1's `scrub_string` rewrite); if B5.1 shipped it, this passes — keep these tests as the explicit regression. If B5.1 was scoped to PEM-only, add the `generic_sub` block now.

- [ ] 4. Run it — PASS: `python3 scripts/test_scrub_payload.py` → OK.

- [ ] 5. Commit: `scrub: redact lowercase free-text secret assignments (placeholder-filtered)`

---

## Task B5.5 — Fail-closed tripwire

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/scrub-payload.py`
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`

**Interfaces** — consumes: `secret_rules.RULES`, `secret_rules.GENERIC`, `secret_rules.ALLOW`, `secret_rules.is_placeholder`. produces: `ScrubAmbiguityError`, `_scan_for_surviving_secrets(text) -> list[tuple[str, str]]`, CLI exit code `4` when a secret shape survives scrubbing.

**Steps**

- [ ] 1. Write failing tests:
   ```python
   class TripwireFailClosed(unittest.TestCase):
       def test_scan_finds_surviving_pem(self):
           hits = scrub_payload._scan_for_surviving_secrets('-----BEGIN PRIVATE KEY-----')  <!-- pragma: allowlist secret -->
           self.assertTrue(any(n == 'private-key' for n, _ in hits))

       def test_clean_scrubbed_payload_scans_empty(self):
           self.assertEqual(scrub_payload._scan_for_surviving_secrets('[redacted:token-1]'), [])

       def test_cli_returns_4_when_secret_survives(self):
           # force a survivor by monkeypatching scrub to a no-op pass-through
           with mock.patch.object(scrub_payload.Scrubber, 'scrub',
                                  lambda self, v: v):
               rc, _, err = run_cli([], json.dumps({'k': 'AKIAIOSFODNN7EXAMPLE'}))  # pragma: allowlist secret
           self.assertEqual(rc, 4)
           self.assertIn('tripwire', err)

       def test_scrub_ambiguity_error_exists(self):
           self.assertTrue(issubclass(scrub_payload.ScrubAmbiguityError, Exception))
   ```

- [ ] 2. Run it — FAILS (`_scan_for_surviving_secrets` / `ScrubAmbiguityError` undefined; rc-4 path missing): `python3 scripts/test_scrub_payload.py`.

- [ ] 3. Minimal impl in `scrub-payload.py`. Add the exception near `AmbiguousValueError`:
   ```python
   class ScrubAmbiguityError(Exception):
       """Raised when a secret-shaped substring SURVIVES scrubbing.

       This is the audit-or-don't-egress invariant's last gate: the payload was
       scrubbed, re-serialized, and re-scanned with the shared registry, and a
       credential shape was still present. The MCP tool MUST treat this exactly
       like AmbiguousValueError — hold the payload, surface the error, no egress.
       """
   ```
   Add the tripwire scanner:
   ```python
   # Rules whose surviving presence after scrubbing is NEVER acceptable. Drawn
   # from the same shared registry — one source of truth for detection too.
   def _scan_for_surviving_secrets(text: str) -> list[tuple[str, str]]:
       """Return [(rule_name, redacted_hint), ...] for any registry rule that still
       matches `text`. The redacted token form `[redacted:...]` is registry-immune
       (no rule matches it), so a fully-scrubbed payload scans clean."""
       hits: list[tuple[str, str]] = []
       for line in text.splitlines():
           if secret_rules.ALLOW.search(line):
               continue
           for rule_name, pat in secret_rules.RULES:
               m = pat.search(line)
               if m:
                   frag = m.group(0)
                   hint = frag if len(frag) <= 8 else f'{frag[:4]}***{frag[-2:]}'
                   hits.append((rule_name, hint))
           g = secret_rules.GENERIC.search(line)
           if g and not secret_rules.is_placeholder(g.group(2)):
               hits.append((f'secret-assignment ({g.group(1)})', '***'))
       return hits
   ```
   Wire it into `main` so egress is blocked fail-closed (replace the existing scrub→serialize→stdout block):
   ```python
       scrubber = Scrubber()
       try:
           scrubbed = scrubber.scrub(payload)
       except AmbiguousValueError as exc:
           sys.stderr.write(f'scrub-payload: ambiguity — refusing to egress: {exc}\n')
           return 3

       serialized = json.dumps(scrubbed, indent=2)

       # Fail-closed tripwire: re-scan the SERIALIZED scrubbed payload with the
       # shared registry. If any secret shape survived, we DO NOT EGRESS.
       survivors = _scan_for_surviving_secrets(serialized)
       if survivors:
           sys.stderr.write(
               'scrub-payload: tripwire — secret shape survived scrubbing, '
               'refusing to egress:\n'
           )
           for rule_name, hint in survivors:
               sys.stderr.write(f'  [{rule_name}] {hint}\n')
           return 4

       sys.stdout.write(serialized + '\n')
   ```

- [ ] 4. Run it — PASS: `python3 scripts/test_scrub_payload.py` → OK.

- [ ] 5. Commit: `scrub: fail-closed tripwire — block egress if a secret shape survives`

---

## Task B5.6 — Regression: existing contract unchanged + docstring/exit-code update

**Files**
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/scrub-payload.py` (docstring exit-code table)
- modify `/home/ilaaj-agent/projects/ilaaj/nanoclaw-v2/container/agent-runner/scripts/test_scrub_payload.py`

**Interfaces** — consumes: nothing new. produces: documented exit code `4`; a pin that the existing happy-path contract (IP/host/email/discord/dict/coreference/CLI) still holds.

**Steps**

- [ ] 1. Keep the full existing suite and add the exit-code pin:
   ```python
   class ExitCodeContract(unittest.TestCase):
       def test_clean_payload_still_exits_0(self):
           rc, out, _ = run_cli([], json.dumps({'msg': 'host 192.168.1.1'}))
           self.assertEqual(rc, 0)
           self.assertIn('[redacted:ip-1]', json.loads(out)['msg'])
   ```

- [ ] 2. Run the whole suite — must be all green incl. every pre-existing test (a red here means the refactor broke continuity): `python3 scripts/test_scrub_payload.py`.

- [ ] 3. Minimal impl — update the docstring exit-code table to add `4 = secret survived scrubbing (caller MUST escalate, treat as do-not-egress)`. No logic change.

- [ ] 4. Run it — PASS: whole suite green.

- [ ] 5. Commit: `scrub: document exit-code 4 + pin existing redaction contract`

> **End of Part B:** open the PR, human merges, return the deploy checkout to `main`. **Out-of-slice follow-ups to flag in the PR description:** (a) `consult-elrond.ts` already aborts on any non-zero rc, so rc 4 is honored — add a one-line comment/branch treating 4 identically to 3 in the egress-audit path; (b) Part A's floor pin test must exist in homelab-infra so the floor side also fails if the registry forks; (c) optional `re.DOTALL` full-PEM-body span replacement if review shows partial key bodies leaking past the marker (the tripwire makes this fail-closed in the meantime).

---

# Part C — jaghelm (instantiation)

> Part C re-instantiates the hardened floor into jaghelm and adds .gitignore negations + a template-tracked CI assertion. It consumes the **hardened** `secret-scan.py` + new `secret_rules.py` produced by Part A (copy, not `harness init` — init is a scaffolder that skips existing files and does not know about `secret_rules.py`). jaghelm is a normal/public-mirror repo → branch in a worktree, open a PR, human merges. Never push to main, never commit a real key. All commands run from `jaghelm/` repo root.

> **`secret_rules.py` is optional for THIS part's correctness** — if Part A keeps everything inline in `secret-scan.py`, drop the `secret_rules.py` copy and the import test; the planted-key regression still holds against the single-file scanner. The tasks below handle both.

## Task C1 — Land the hardened secret-scan into jaghelm

**Files**
- create `/home/ilaaj-agent/jaghelm/scripts/secret-scan.py` (copied from canonical floor, exec bit set)
- create `/home/ilaaj-agent/jaghelm/scripts/secret_rules.py` (IF Part A split rules out — else skip)
- modify `/home/ilaaj-agent/jaghelm/package.json` (add `secret-scan` script)
- create `/home/ilaaj-agent/jaghelm/scripts/secret-scan.test.sh` (executable)

**Interfaces** — consumes: hardened `/home/ilaaj-agent/homelab-infra/docs/harness/templates/floor/secret-scan.py` (+ `secret_rules.py`). produces: a repo-local blocking scanner + `npm run secret-scan`.

**Steps**

- [ ] 1. Write failing test — create `scripts/secret-scan.test.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   ROOT="$(git rev-parse --show-toplevel)"
   cd "$ROOT"
   test -x scripts/secret-scan.py || { echo "FAIL: scripts/secret-scan.py missing/not executable"; exit 1; }
   # planted GCP service-account key in a tmp file MUST be caught (exit 1)
   tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
   printf '{\n  "type":"service_account",\n  "private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvFAKE\\n-----END PRIVATE KEY-----\\n"\n}\n' > "$tmp"  <!-- pragma: allowlist secret -->
   if python3 scripts/secret-scan.py "$tmp"; then echo "FAIL: scanner did not flag a GCP SA key"; exit 1; fi
   echo "PASS: secret-scan present + catches GCP SA key"
   ```

- [ ] 2. Run it — expect FAIL: `bash scripts/secret-scan.test.sh` → `FAIL: scripts/secret-scan.py missing/not executable` (exit 1).

- [ ] 3. Minimal impl: `cp ~/homelab-infra/docs/harness/templates/floor/secret-scan.py scripts/secret-scan.py && chmod +x scripts/secret-scan.py` (and `cp ~/homelab-infra/docs/harness/templates/floor/secret_rules.py scripts/secret_rules.py` only if it exists in the hardened floor). Add `"secret-scan": "python3 scripts/secret-scan.py"` to `package.json` scripts.

- [ ] 4. Run it — expect PASS: `bash scripts/secret-scan.test.sh` → `PASS …` (exit 0). Sanity: `npm run secret-scan` → clean on the current tree.

- [ ] 5. Commit: `floor(jaghelm): add hardened secret-scan from canonical floor`

---

## Task C2 — Hardened `.gitignore` block + FCM template (renamed `.example`)

**Files**
- modify `/home/ilaaj-agent/jaghelm/.gitignore` (append block below)
- create `/home/ilaaj-agent/jaghelm/fcm-service-account.json.example` (new committed template with a fake key)
- create `/home/ilaaj-agent/jaghelm/scripts/gitignore-floor.test.sh` (executable)

**Interfaces** — consumes: nothing. produces: ignore rules for mobile/web secrets + surviving `.example`/`.sample` templates.

**Steps**

- [ ] 1. Write failing test — `scripts/gitignore-floor.test.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(git rev-parse --show-toplevel)"
   fail=0
   # real secrets MUST be ignored
   for s in test.pem test.jks google-services.json acme-service-account.json keystore.properties; do
     git check-ignore -q "$s" || { echo "FAIL: $s is NOT ignored"; fail=1; }
   done
   # templates MUST NOT be ignored (negations win)
   for t in env.example fcm-service-account.json.example .env.example; do
     if git check-ignore -q "$t"; then echo "FAIL: template $t IS ignored"; fail=1; fi
   done
   # the FCM template file must exist on disk
   test -f fcm-service-account.json.example || { echo "FAIL: fcm-service-account.json.example missing"; fail=1; }
   [ "$fail" -eq 0 ] && echo "PASS: gitignore floor correct"
   exit "$fail"
   ```

- [ ] 2. Run it — expect FAIL: `bash scripts/gitignore-floor.test.sh` → `FAIL: test.pem is NOT ignored` (current `.gitignore` ignores none of these), plus `FAIL: fcm-service-account.json.example missing`.

- [ ] 3. Minimal impl — append this block to `.gitignore` AFTER jaghelm's existing 5 lines:
   ```gitignore
   # --- secrets (harness floor) — never commit credentials ---
   # (Phase 0 hardened: web + mobile secret classes. Negations below keep templates tracked.)
   .env
   .env.*
   *.key
   *.pem
   *.p12
   *.pfx
   *.pkcs12
   id_rsa
   id_ed25519
   *credential*
   *-secret.json
   *service-account*.json
   .secrets/

   # mobile / FCM secret classes (pre-empt Android + push creds)
   *.jks
   *.keystore
   keystore.properties
   google-services.json
   GoogleService-Info.plist

   # --- template NEGATIONS — committed *.example / *.sample templates MUST stay tracked ---
   # Broad first so it survives EVERY ignore glob above (incl. *service-account*.json,
   # *credential*, *.pem). Git evaluates last-match-wins, so these negations come last.
   !**/*.example
   !**/*.sample
   !.env.example
   !.env.sample
   # The FCM template is renamed so NO *service-account*.json glob can swallow it, AND
   # it is double-protected by the *.example negation above. Keep BOTH belt + braces:
   !fcm-service-account.json.example
   !**/google-services.json.example
   ```
   Create `fcm-service-account.json.example` with an obviously-fake placeholder (NOT a real key — use `"private_key": "REDACTED-EXAMPLE-NOT-A-REAL-KEY"` so it's a true template and trips nothing).  <!-- pragma: allowlist secret -->

- [ ] 4. Run it — expect PASS: `bash scripts/gitignore-floor.test.sh` → `PASS …`. Verify `git check-ignore -v fcm-service-account.json.example` shows the `!**/*.example` negation as the deciding rule.

- [ ] 5. Commit: `floor(jaghelm): harden .gitignore for web+mobile secrets, add FCM template`

---

## Task C3 — Regression: FCM template stays tracked AND scanner skips it

**Files**
- create `/home/ilaaj-agent/jaghelm/scripts/template-tracked.test.sh` (executable)

**Interfaces** — consumes: the committed templates + the scanner. produces: the regression that C5's CI step mirrors.

> Note: the canonical scanner's `scannable()` skips `.example` files for the *generic* rule but, per Part A's hardening, FORMAT rules now run on `.example` files. The `fcm-service-account.json.example` template therefore MUST use a clearly-fake non-PEM placeholder (`REDACTED-EXAMPLE-NOT-A-REAL-KEY` from C2), which matches no format rule → scanner exits 0. This test pins that the chosen placeholder does not trip the hardened scanner.

**Steps**

- [ ] 1. Write failing test — `scripts/template-tracked.test.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(git rev-parse --show-toplevel)"
   fail=0
   for f in env.example fcm-service-account.json.example; do
     git ls-files --error-unmatch -- "$f" >/dev/null 2>&1 \
       && echo "  ok tracked: $f" || { echo "  FAIL untracked: $f"; fail=1; }
   done
   # the scanner must NOT flag the .example (fake placeholder) -> exit 0
   python3 scripts/secret-scan.py fcm-service-account.json.example \
     || { echo "FAIL: scanner flagged the .example template"; fail=1; }
   [ "$fail" -eq 0 ] && echo "PASS: FCM template tracked + skipped by scanner"
   exit "$fail"
   ```

- [ ] 2. Run it — expect FAIL if run before C2 commits + stages the file: `FAIL untracked: fcm-service-account.json.example` (`git ls-files --error-unmatch` fails on an unstaged file).

- [ ] 3. Minimal impl — ensure `git add fcm-service-account.json.example env.example` (C2 staged the template); no new code — this task's "impl" is making the file tracked + relying on the fake-placeholder template not tripping the scanner.

- [ ] 4. Run it — expect PASS: `bash scripts/template-tracked.test.sh` → `ok tracked: …` ×2 + `PASS …`.

- [ ] 5. Commit: `test(jaghelm): regression — FCM .example stays tracked and scanner-clean`

---

## Task C4 — Regression: a planted GCP key in the jaghelm tree is caught by the refreshed scanner

**Files**
- create `/home/ilaaj-agent/jaghelm/scripts/planted-key.test.sh` (executable)

**Interfaces** — consumes: `scripts/secret-scan.py`. produces: proof the floor catches the canonical leak (GCP SA JSON + PEM/PKCS#8). **No real secret committed** — the planted key is written to a `mktemp` path outside the worktree and removed.

**Steps**

- [ ] 1. Write failing test — `scripts/planted-key.test.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(git rev-parse --show-toplevel)"
   d="$(mktemp -d)"; trap 'rm -rf "$d"' EXIT
   # (a) GCP service-account JSON
   printf '{\n "type":"service_account",\n "private_key":"-----BEGIN PRIVATE KEY-----\\nMIIEvFAKEFAKEFAKE\\n-----END PRIVATE KEY-----\\n"\n}\n' > "$d/sa.json"  <!-- pragma: allowlist secret -->
   # (b) bare PKCS#8 PEM
   printf -- '-----BEGIN PRIVATE KEY-----\nMIIEvFAKE\n-----END PRIVATE KEY-----\n' > "$d/key.pem"  <!-- pragma: allowlist secret -->
   fail=0
   python3 scripts/secret-scan.py "$d/sa.json" && { echo "FAIL: GCP SA JSON not caught"; fail=1; }
   python3 scripts/secret-scan.py "$d/key.pem" && { echo "FAIL: PEM not caught"; fail=1; }
   [ "$fail" -eq 0 ] && echo "PASS: planted GCP key + PEM both flagged"
   exit "$fail"
   ```

- [ ] 2. Run it — expect FAIL when run before C1 lands the scanner (run this task strictly after C1; to force an explicit RED, temporarily point it at an empty-stub `scripts/secret-scan.py` that always `sys.exit(0)` → both `FAIL:` lines fire).

- [ ] 3. Minimal impl — none beyond C1's real scanner (the canonical scanner already satisfies both: GCP SA JSON → exit 1, PEM → exit 1). If Part A hardening tightened PKCS#8 detection, this test is the guardrail proving the hardened copy didn't regress.

- [ ] 4. Run it — expect PASS: `bash scripts/planted-key.test.sh` → `PASS: planted GCP key + PEM both flagged`.

- [ ] 5. Commit: `test(jaghelm): regression — planted GCP SA key + PEM caught by floor scanner`

---

## Task C5 — Wire secret-scan + template-tracked into `.gitea/workflows/check.yml`

**Files**
- modify `/home/ilaaj-agent/jaghelm/.gitea/workflows/check.yml` (add the two steps below)
- create `/home/ilaaj-agent/jaghelm/scripts/check-yaml-floor.test.sh` (executable)
- (optional) mirror the same two steps into `/home/ilaaj-agent/jaghelm/.github/workflows/build-push.yml`'s `test` job as a post-merge backstop

**Interfaces** — consumes: the two CI steps below. produces: a per-PR blocking floor gate.

**Steps**

- [ ] 1. Write failing test — `scripts/check-yaml-floor.test.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   cd "$(git rev-parse --show-toplevel)"
   wf=".gitea/workflows/check.yml"
   fail=0
   python3 -c "import yaml,sys; yaml.safe_load(open('$wf'))" || { echo "FAIL: $wf not valid YAML"; fail=1; }
   grep -q "secret-scan.py" "$wf" || { echo "FAIL: no secret-scan step in $wf"; fail=1; }
   grep -q "git ls-files --error-unmatch" "$wf" || { echo "FAIL: no template-tracked assert in $wf"; fail=1; }
   grep -q "fcm-service-account.json.example" "$wf" || { echo "FAIL: FCM template not asserted in $wf"; fail=1; }
   # run the actual assertion logic locally to prove it passes on this tree
   bash scripts/template-tracked.test.sh >/dev/null || { echo "FAIL: template-tracked logic fails locally"; fail=1; }
   [ "$fail" -eq 0 ] && echo "PASS: check.yml wires the floor gate"
   exit "$fail"
   ```

- [ ] 2. Run it — expect FAIL: `bash scripts/check-yaml-floor.test.sh` → `FAIL: no secret-scan step in .gitea/workflows/check.yml` (current check.yml has neither step).

- [ ] 3. Minimal impl — insert these two steps into `check.yml` BEFORE the existing `npm ci` step (they need no node_modules; fail fast and cheap):
   ```yaml
         # --- harness floor: secret scan + template-tracked guard (Phase 0) ---
         # Runs on PR-head BEFORE npm ci so a leaked key / dropped template fails fast.
         - name: Secret scan (harness floor — blocks committed credentials)
           run: python3 scripts/secret-scan.py

         - name: Assert secret-template files are tracked (negations didn't drop them)
           run: |
             set -euo pipefail
             # Each path MUST be a committed template; --error-unmatch exits 1 if not tracked.
             # If you add a new committed *.example secret template, add it here too.
             templates=(
               "env.example"
               "fcm-service-account.json.example"
             )
             missing=0
             for f in "${templates[@]}"; do
               if git ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
                 echo "  ok   tracked: $f"
               else
                 echo "  FAIL untracked (ignored or deleted?): $f"
                 missing=1
               fi
             done
             if [ "$missing" -ne 0 ]; then
               echo "::error::a required secret-template file is not git-tracked — check .gitignore negations (!**/*.example)"
               exit 1
             fi
   ```
   The check.yml container is `node:22` — `python3` is not guaranteed. Pick one in this step: (a) add `apt-get update -qq && apt-get install -y -qq --no-install-recommends python3` as the first line of the Secret-scan step (mirrors check.yml's existing manual-bootstrap pattern), or (b) split the floor steps into a sibling `floor:` job using `python:3.11-slim` exactly like the canonical `check.gitea.yml`. The test only checks presence + YAML validity + local logic.

- [ ] 4. Run it — expect PASS: `bash scripts/check-yaml-floor.test.sh` → `PASS: check.yml wires the floor gate`. (Live CI confirmation happens on the PR run.)

- [ ] 5. Commit: `ci(jaghelm): run secret-scan + assert secret templates tracked on every PR`

> **End of Part C:** branch the 5 commits in a jaghelm worktree → open PR → human merges (never push to main, never commit a real key). After merge, refresh `.harness.yml` `evidence:` to stamp the new controls (separate follow-up, not part of the secret floor): `enforcers: [..., scripts/secret-scan.py]` and `verification: [.gitea/workflows/check.yml, ...]`.

---

## Self-review checklist

Maps each task to the spec's Phase 0 requirements and the Verification "Secret-floor regression" tests.

**Spec Phase 0 — scanner hardening (canonical floor):**
- [ ] A1 — shared `secret_rules.RULES` registry exists as a single source of truth; entropy-gated `is_placeholder` closes the `len<=24` hole (a long high-entropy secret containing "example" is no longer dropped). Crown jewels `PEM_PRIVATE_KEY` + `GCP_SERVICE_ACCOUNT_*` exported by name.
- [ ] A2 — `secret-scan.py` consumes the shared registry; FORMAT rules run on ALL files incl. `.example`/`.sample` and lockfiles (closes the skip-set hole); `errors="replace"` closes the bad-byte silent-skip hole; GENERIC rule entropy/placeholder-filtered.
- [ ] A3 — `init.py` propagates `secret_rules.py` into `scripts/` so the floor scanner's import resolves fleet-wide; propagated scanner verified to catch a PEM in a fresh repo.
- [ ] A4 — `scan.py assess()` requires non-empty FILE evidence (closes the stub/zero-byte + directory evidence holes), fails closed on unknown level strings (closes the `L9`/`l3` fail-open), and content-signature-verifies the enforcers secret-scan defends PEM + service_account (closes the empty-placeholder over-claim).

**Spec Phase 0 — egress floor (scrubber):**
- [ ] B5.0 — registry vendored byte-identical into nanoclaw with a self-consistent + canonical-equality drift pin (one registry, two consumers).
- [ ] B5.1–B5.4 — scrubber redacts PEM/PKCS#8, inline GCP SA `private_key`, AWS/Azure/Stripe/GH-fine-PAT/Google API key, and lowercase free-text assignments — all derived from the shared registry.
- [ ] B5.5 — fail-closed tripwire: re-scans the serialized scrubbed payload and returns rc 4 (no egress) if any secret shape survived.
- [ ] B5.6 — existing 14-test contract unchanged; exit-code 4 documented.

**Spec Phase 0 — jaghelm instantiation (the public-repo gate):**
- [ ] C1 — hardened scanner landed in jaghelm + `npm run secret-scan`; catches a GCP SA key.
- [ ] C2 — `.gitignore` hardened for web + mobile (FCM/keystore/google-services.json) secret classes with `!**/*.example` negations; FCM template renamed to `.example` and tracked.
- [ ] C3 — FCM `.example` stays tracked AND does not trip the scanner (fake placeholder).
- [ ] C5 — per-PR blocking `check.yml` runs secret-scan + asserts templates tracked.

**Verification — "Secret-floor regression" tests (the canonical leak set must be blocked end-to-end):**
- [ ] GCP service-account JSON blocked at commit/CI (A2 secret_scan.test.py assertion 2; C1 secret-scan.test.sh; C4 planted-key.test.sh) AND at egress (B5.2 GcpServiceAccountScrubbing).
- [ ] PEM / PKCS#8 private key blocked at commit/CI (A2 assertions 1/3/4; C4 planted-key.test.sh) AND at egress (B5.1 PrivateKeyScrubbing).
- [ ] `.example`/lockfile/bad-byte evasion paths closed (A2 assertions 2/3/4).
- [ ] entropy-bypass evasion closed (A1 long-high-entropy-"example" assertion; A2 assertion 5).
- [ ] stub-evidence / fail-open conformance over-claims closed (A4 stub + directory + L9 + content-signature assertions).
- [ ] egress fail-closed if a secret survives scrubbing (B5.5 tripwire rc-4).
- [ ] registry cannot silently fork between scanner and scrubber (B5.0 pin; A4 `_defends_crown_jewels` "imports secret_rules" path).
- [ ] template-tracked CI assertion survives any future ignore glob (C3 + C5; `git ls-files --error-unmatch`).