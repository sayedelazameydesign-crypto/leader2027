<!-- ⚠️ GENERATED FILE — do not edit by hand -->
<!-- Source: project.manifest.json · Generator: scripts/generate-readme.mjs -->

# Leader 2027

> An operations and management platform for an election campaign: people (source-aware), volunteers, field work, reports, and operational KPIs — in a single command dashboard. **No political preference data of any kind** (Product Contract §5).

**v0.1.0** · **MIT** · **Node 22+** · [العربية](README.md)

## Status

**VS4** — VS1+VS2 = **MERGED into main (PR #1)** · VS3 (administrative campaign core) = **implemented — gates green** · VS4 (live kernel + atomic nuclei) = **implemented — gates green**.

| Slice | Description | State | Evidence |
| --- | --- | --- | --- |
| **VS1** | Foundation | Merged | `PR #1` |
| **VS2** | People + Volunteers + Field Reports | Merged | `PR #1` |
| **VS3** | Administrative Campaign Core | Implemented | `docs/contract-vs3.md` |
| **VS4** | Live Kernel + Atomic Nuclei | Implemented | `docs/kernel.md` |

## Binding Principles

- **§5 is absolute:** no political affiliation, no "persuadability score", no inferring them from behavior — any payload carrying them is explicitly rejected.
- **No button-hiding as authorization:** permissions are enforced server-side (policy + service + API); hiding UI is a UX nicety only.
- **Contract before code:** every slice is locked by a contract (`docs/contract-*.md`) before a single line of implementation.
- **No claim without evidence:** every accepted criterion has an evidence artifact (test / smoke check / log).
- **Isolation before intelligence:** every AI capability passes an audited human-approval gate, with no cross-nucleus imports.

## Running

```bash
npm ci
```

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` | Production build |
| `npm run start` | Production server on 0.0.0.0:3000 |
| `npm run test` | 166 unit/integration (98 existing + 68 kernel) |
| `npm run smoke` | 45 production checks against a running server (`BASE_URL` optional) |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run readme:generate` | Generate the README from the manifest |
| `npm run readme:check` | Detect README drift from the manifest |
| `npm run readme:drift` | Advisory check: manifest vs code (warnings only) |

## Demo Operations Accounts (seed-only)

| Email | Role | Level |
| --- | --- | --- |
| `owner@leader2027.test` | Owner — `OWNER` | Management |
| `admin@leader2027.test` | Campaign Admin — `CAMPAIGN_ADMIN` | Management |
| `manager@leader2027.test` | Campaign Manager — `CAMPAIGN_MANAGER` | Management |
| `coordinator@leader2027.test` | Field Coordinator — `FIELD_COORDINATOR` | Field |
| `worker@leader2027.test` | Field Worker — `FIELD_WORKER` | Field |
| `viewer@leader2027.test` | Viewer — `VIEWER` | Read-only |

Password for all accounts: `Demo!2345` — demo seed-only operations data, not production credentials.

## Permission Matrix

| Action | `OWNER` | `CAMPAIGN_ADMIN` | `CAMPAIGN_MANAGER` | `FIELD_COORDINATOR` | `FIELD_WORKER` | `VIEWER` |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard — `dashboard:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| View people — `people:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create person — `people:create` | ✅ | ✅ | ✅ | ✅ | — | — |
| Update person — `people:update` | ✅ | ✅ | ✅ | ✅ | — | — |
| View volunteers — `volunteers:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create volunteer — `volunteers:create` | ✅ | ✅ | ✅ | ✅ | — | — |
| Update volunteer — `volunteers:update` | ✅ | ✅ | ✅ | ✅ | — | — |
| View reports — `reports:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create report — `reports:create` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Update notes — `reports:update_notes` | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Update status — `reports:update_status` | ✅ | ✅ | ✅ | ✅ | — | — |
| Manage users — `users:manage` | ✅ | ✅ | ✅ | — | — | — |
| Manage settings — `settings:manage` | ✅ | ✅ | ✅ | — | — | — |
| View audit — `audit:view` | ✅ | ✅ | ✅ | ✅ | — | — |

### Session Rules

- Changing a role revokes every previous session immediately (`session_epoch`) — changing name/team does not.
- Email and password are immutable in v1.
- Sessions are HMAC-SHA256 signed cookies; passwords use scrypt (`node:crypto`) — zero extra dependencies.

## API

| Method | Path | Note |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Sign in (signed cookie) |
| `POST` | `/api/auth/logout` | Sign out |
| `GET` | `/api/health` | Health check (no auth) |
| `GET/POST` | `/api/people` | List / create |
| `GET/PATCH` | `/api/people/:id` | Read / update |
| `GET/POST` | `/api/volunteers` | List / create |
| `GET/PATCH` | `/api/volunteers/:id` | Read / update status |
| `GET/POST` | `/api/field/reports` | List / create |
| `GET/PATCH` | `/api/field/reports/:id` | Read / notes + status |
| `GET` | `/api/stats` | Operational KPIs |
| `GET/PATCH` | `/api/campaign` | Campaign (settings:manage) |
| `GET/POST` | `/api/cycles` | Election cycles |
| `PATCH` | `/api/cycles/:id` | Update a cycle |
| `GET/POST` | `/api/regions` | Regions |
| `GET/POST` | `/api/teams` | Teams |
| `GET/POST` | `/api/users` | Users (users:manage) |
| `PATCH` | `/api/users/:id` | Name/role/team/region — email and password are immutable in v1 |
| `GET/PATCH` | `/api/kernel` | Live nuclei snapshot / tune a nucleus (settings:manage) |
| `GET` | `/api/kernel/cells` | Nucleus and tool catalogue for agents |
| `POST` | `/api/kernel/actions` | Execute a tool / grant or deny an approval |

Every mutation writes an AuditEvent · `password_hash` never appears in any response.

## Screens

- `/` dashboard · `/people` + `/people/[id]` · `/volunteers` + `/volunteers/[id]`
- `/field/reports` + `/field/reports/new` + `/field/reports/[id]` · `/login`
- `/admin` (campaign/cycles/regions/teams) · `/admin/users` — all behind the auth boundary
- `/kernel` — the live kernel: corners, their knobs, and the human approval queue

## Structure

```text
app/          Pages + API + globals.css + layout
components/   admin / dashboard / field / people / volunteers / ui
lib/          domain / repositories / persistence / auth / authorization / audit / validation
scripts/      Doc generation + drift check
docs/         Contracts, plans, sync record
tests/        unit / integration / smoke
```

| Path | Contents |
| --- | --- |
| `app/(app)/` | Dashboard, people, volunteers, reports, admin — behind the auth boundary |
| `app/login/` | Sign-in |
| `lib/kernel/` | The kernel: contracts, manifest, bus, approvals, kernel, composition root |
| `lib/cells/` | The eight atomic nuclei — one per corner, isolated and independent |
| `app/api/` | people / volunteers / field/reports / stats / auth / campaign / cycles / regions / teams / users / health |
| `lib/domain/` | Entity rules + services — people/volunteers/field/stats/dashboard/settings/users |
| `lib/repositories/` | Store interfaces (Domain → Repository Interface → Persistence Adapter) |
| `lib/persistence/` | InMemory + FileJson — PostgreSQL later without rewriting the domain |
| `lib/auth+authorization+audit+validation` | HMAC sessions, six-role matrix, audit per mutation, §5 rejection |
| `scripts/` | Doc generation from `project.manifest.json` + drift check |
| `tests/` | unit + integration + smoke (run in CI against next start) |
| `project.manifest.json` | **Single source of truth** — the README is generated from it |

## Environment Variables

| Variable | Values | Default | Note |
| --- | --- | --- | --- |
| `L27_STORE` | memory \| file | `file` | Store kind |
| `L27_DB_PATH` | path | `var/data/db.json` | Data file path (file mode) |
| `L27_SESSION_SECRET` | secret | `l27-dev-secret-change-me` | Session signing secret — **change it in production** |

## Quality Gates

| Gate | Command | Expected |
| --- | --- | --- |
| `typecheck` | `npm run typecheck` | **clean** |
| `tests` | `npm test` | **166/166** |
| `build` | `npm run build` | **PASS** |
| `smoke` | `npm run smoke` | **45/45** |
| `ci` | `GitHub Actions` | **PASS** |

CI runs all of these on every push/PR — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Deploying to Vercel

- Vercel-ready (standard Next.js + lockfile + green CI). Deploying requires linking your account at [vercel.com/new](https://vercel.com/new) and importing the repo — or `npx vercel`.
- **Known caveat:** serverless disk on Vercel is ephemeral — a PostgreSQL adapter lands later on the same `Repository Interface` with no domain rewrite (TODO documented in `lib/persistence/file-json.ts`).
- Deployment counts as **DEPLOYED = VERIFIED** only after the live URL has actually been exercised.

## GitHub Sync

[`docs/sync-verification.md`](docs/sync-verification.md)

- No commit before an intentional change plus green gates.
- A merge is only proven by `mergedAt ≠ null`.
- The proven loop: `CHANGE → COMMIT → PUSH → VERIFY_REMOTE`.

## Documentation

| File | Contents |
| --- | --- |
| [`docs/contract-vs3.md`](docs/contract-vs3.md) | VS3 contract (LOCKED) |
| [`docs/plan-vs2.md`](docs/plan-vs2.md) | VS2 plan as implemented |
| [`docs/plan-vs3.md`](docs/plan-vs3.md) | VS3 plan as implemented |
| [`docs/sync-verification.md`](docs/sync-verification.md) | Sync verification record |
| [`docs/readme-generation.md`](docs/readme-generation.md) | How this file is generated |
| [`docs/kernel.md`](docs/kernel.md) | Live kernel & atomic nuclei architecture |

## Explicitly Out of Scope

- ❌ Editing a user's email/password (v2)
- ❌ Deleting entities
- ❌ `VoterRecord` and the remaining §13 items
- ❌ Any Assign Task UI (P3)
- ❌ Any political-preference field — permanently forbidden (§5)

## How This File Is Generated

This README is a **derived artifact** and is never edited by hand:

```text
project.manifest.json  (single source of truth)
        │
        ├── npm run readme:generate  →  README.md + README.en.md
        ├── npm run readme:check     →  drift detection vs the manifest
        └── npm run readme:drift     →  advisory check: manifest vs code
```

```bash
npm run readme:generate   # edit the manifest, then generate
npm run readme:check      # fails if the README is stale
```
**Decoupled from the build:** a README generation failure **never fails** the system build or its tests —
in CI generation runs as an advisory step (`continue-on-error`) that emits a warning only.
