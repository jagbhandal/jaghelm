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
from collections import Counter

# --- named Phase-0 crown-jewel signatures (verifier asserts these by name) ---
PEM_PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----"
)
# GCP service-account JSON: the private_key PEM line is the operative detection signal.
# GCP_SERVICE_ACCOUNT_TYPE is exported for the conformance verifier to assert it remains
# present in deployed scanners; it does NOT need to co-occur with the private_key match.
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

ALLOW = re.compile(r"(?:pragma:\s*allowlist secret|gitleaks:allow|\bnosecret\b)", re.I)
# Whole-value placeholder matcher: anchored ^...$, case-insensitive.
# A value is excused ONLY when its ENTIRE stripped content matches a known-dummy pattern —
# not merely when a placeholder word appears as a substring inside a high-entropy blob.
#
# Pattern families:
#   A. obvious single-word placeholders (changeme, placeholder, dummy, …)
#   B. example token (optionally trailed by separator+word runs, e.g. example.com, example-key)
#   C. <angle-bracket> env tokens
#   D. ${env-var} tokens
#   E. optional your/my/the/a prefix + credential word + optional here/value suffix
#      (covers: your-token-here, your-api-key, secret-here, token-placeholder, …)
#   F. ALL-CAPS env-var names containing a credential word (YOUR_API_KEY_HERE, FCM_SECRET, …)
#      Note: ${...} is matched by D, so F only covers bare uppercase env names.
PLACEHOLDER_WHOLE = re.compile(
    r"""(?ix)^(?:
        # A — obvious single-word dummies
        changeme | change[-]me | replace[-]?me | fixme | todo | tbd
        | placeholder | dummy | sample | redacted | none | null | true | false
        # B — "example" optionally followed by short separator+word runs (example, example.com,
        #     example-key, example-api-key). Segments are capped at 15 chars and limited to 3
        #     repetitions so long hex/base64 blobs (example-1234567890abcdef...) are NOT excused.
        | example (?:[-_.][a-z0-9]{1,15}){0,3}
        # C — <angle-bracket tokens>
        | <[^>]+>
        # D — ${env-var tokens}  (\$ escapes the literal $ in verbose mode)
        | \$\{[^}]*\}
        # E — optional leading determiner + credential keyword + optional trailing hint
        #     separator between components: any run of [-_.\s]
        | (?:your|my|the|a)?[-_.\s]*
          (?:api[-_]?key | secret | token | password | passwd | key | client[-_]?secret)
          [-_.\s]*
          (?:here | goes[-_]?here | value | placeholder | goes)?
        # F — SCREAMING_SNAKE_CASE identifiers whose name embeds a credential word (bare, not
        #     wrapped in ${}). REQUIRES at least one underscore somewhere in the identifier via a
        #     lookahead (?=[A-Z0-9_]*_) so genuine env-var names (YOUR_API_KEY_HERE, FCM_SECRET,
        #     MY_API_TOKEN) are excused, but underscore-less all-caps blobs
        #     (ABCDEFGHIJKLMNOPTOKEN, XF3A9TOKEN1234567890X) are NOT excused — they look like
        #     random secrets with a cred-word embedded.
        #     (?-i:...) scopes this alternative to case-SENSITIVE matching despite the outer (?ix)
        #     flag, so mixed-case high-entropy blobs (ExampleSecret123ABC) are also NOT excused.
        | (?-i:(?=[A-Z0-9_]*_)[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|API)[A-Z0-9_]*)
    )$""",
    re.VERBOSE,
)


def shannon_entropy(s):
    """Bits/char Shannon entropy. A real random secret scores high (>~3.0);
    a repetitive placeholder ('xxxxxxxx', 'aaaa') scores low."""
    if not s:
        return 0.0
    n = len(s)
    return -sum((c / n) * math.log2(c / n) for c in Counter(s).values())


def is_placeholder(val, entropy_floor=3.0):
    """True if val looks like a non-secret placeholder.

    A value is excused ONLY when it meets one of four criteria:
      1. Empty / whitespace.
      2. Trivially repetitive: at most 2 distinct characters (e.g. 'xxxxxxxx', 'aaaa').
      3. The WHOLE stripped value matches PLACEHOLDER_WHOLE — i.e. it IS a known dummy
         token, not merely a high-entropy blob that contains a placeholder substring.
      4. Its Shannon entropy is below entropy_floor — a low-entropy string reads as a
         human-typed dummy regardless of whether it matches pattern 3.

    The critical fix vs the old `len(v) <= 24` gate: a short, high-entropy random value
    (e.g. 'ExAmPle1A2B3C4D5E6F7', entropy ~4.1) that happens to contain the word
    'example' does NOT whole-match PLACEHOLDER_WHOLE, so it is NOT excused.
    """
    v = val.strip()
    # Criterion 1: empty
    if not v:
        return True
    # Criterion 2: trivially repetitive (set size <= 2 covers 'xxxx', 'aaaa', '0101', …)
    if len(set(v)) <= 2:
        return True
    # Criterion 3: the whole value IS a placeholder pattern
    if PLACEHOLDER_WHOLE.match(v):
        return True
    # Criterion 4: low-entropy catch-all (human-typed dummies that don't pattern-match)
    return shannon_entropy(v) < entropy_floor
