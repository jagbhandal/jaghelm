# JagHelm: agent map

A self-hosted dashboard for one person's home server. It reads Prometheus (and
optional integrations) and shows the worst problems first. It only reads; it
changes nothing on the servers it watches. Node 26, ESM; Express API in
`server/`, React + Tailwind v4 + shadcn/ui in `src/`.

This file is a map. Read the page for the area you touch before changing it.

## Where to read

| Area | Read |
|---|---|
| How it fits together, repo layout | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), "2. System topology" and "3. Repository layout" first, then only the section you need |
| Status model, severity table | ARCHITECTURE "4.7 Status model", [ADR 0006](docs/adr/0006-one-severity-table.md) |
| Config, secrets, data dir | [docs/CONFIGURATION.md](docs/CONFIGURATION.md), [docs/DATA-DIR.md](docs/DATA-DIR.md), ARCHITECTURE "4.4" |
| Integrations (adding or changing one) | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md), ARCHITECTURE "4.3" |
| UI components, tokens, themes | [docs/design-system.md](docs/design-system.md), [docs/GALLERY.md](docs/GALLERY.md) |
| Frontend structure | ARCHITECTURE "5. Frontend architecture" |
| CI, deploy, rollback | ARCHITECTURE "7. CI/CD pipeline", [docs/RELEASING.md](docs/RELEASING.md) |
| Tests | ARCHITECTURE "8. Testing" |
| Past decisions | [docs/adr/](docs/adr/README.md) |
| Security model, SLOs | [docs/security/STRIDE.md](docs/security/STRIDE.md), [docs/slos/README.md](docs/slos/README.md) |
| Run it with fake data | [docs/DEMO.md](docs/DEMO.md) (`DEMO_MODE=true`) |
| Known problems | [KNOWN-ISSUES.md](KNOWN-ISSUES.md) |

## Commands

```bash
npm run dev            # server + Vite client
npm run lint           # blocking in CI
npm run typecheck
npm run test:ci        # backend, node:test
npm run test:client    # Vitest + React Testing Library
npm run check:assets
npm run gallery:test   # component screenshots + axe (pinned Playwright image)
npm run gallery:update # regenerate baselines; commit them in the PR
npm run test:e2e       # app shell in a browser
npm run secret-scan
```

`.gitea/workflows/check.yml` runs all of these on every PR to `main`. Run the
ones your change touches before you push.

## Rules the tests enforce

Each of these fails CI.

- No author-specific strings (host names, UPS model, node labels) in shipped
  code: `scripts/author-strings.test.mjs`.
- No `window.confirm`, `alert` or `prompt`; use `src/ui/confirm.jsx`:
  `scripts/no-browser-dialogs.test.mjs`.
- `src/phone/` imports no native platform and judges no severity of its own;
  states come from `/api/status`: `scripts/phone-imports.test.mjs`,
  `scripts/phone-no-severity.test.mjs`.
- Design tokens and contrast: `scripts/ui-tokens.test.mjs`,
  `scripts/ui-contrast.test.mjs`.
- No exact preset, integration or test counts in the README or living docs
  (say "35+"): `scripts/doc-counts.test.mjs`.
- First-load budgets: `scripts/first-load.mjs`.
- No secrets in git: `scripts/secret-scan.py`. `.env`, keys and `data/` stay
  ignored. Never print or commit a token.

## Changes and shipping

- Branch off `main`, open a PR to `main` on Gitea. Jag reviews and merges.
  Never push to `main`, never merge your own PR.
- A user-facing server change adds a changelog fragment,
  `changes/<issue>-<slug>.md` ([format](changes/README.md)). Do not edit
  `CHANGELOG.md` directly.
- Merging to `main` deploys to production (vm-103) through `deploy.yml`, with a
  health gate and auto-rollback. Treat every merge as a prod change.
- If a change alters something a doc describes, update that doc in the same PR.
- `.harness.yml` and `.harness-ledger.md` are the harness scorecard and its
  captured failures. Re-stamp the levels when a change moves one.
