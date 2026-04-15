---
'@openmdm/core': minor
'@openmdm/hono': major
---

Tenant + RBAC audit findings, fixes for the two most dangerous holes.

See `docs/proposals/tenant-rbac-audit.mdx` for the full file-and-line
audit. Short version: the `TenantManager`, `AuthorizationManager`, and
`AuditManager` exist as façades but are never consulted by the
resource managers or the HTTP adapter. Core resources (`Device`,
`Policy`, `Command`, `Application`, `Group`, `MDMEvent`) have no
`tenantId` column in the type system or the database schema, so
`mdm.devices.list()` is fleet-wide regardless of tenant context.

This changeset cannot fix the architectural gap in one pass — it spans
type system, schema, every manager, and every integration point. What
it ships instead: **loud-failure backstops** for the two most dangerous
silent-data-leak paths, plus a comprehensive audit document users can
read before planning a multi-tenant deployment.

### `@openmdm/hono` — BREAKING

`honoAdapter({ enableAuth })` now defaults to `true` instead of
`false`. Admin routes on `/mdm/devices`, `/mdm/policies`,
`/mdm/commands`, etc. previously accepted every request when the
caller did not explicitly set `enableAuth: true` — a footgun that the
Quick Start and Installation docs never warned about.

Two startup warnings fire from the adapter's structured logger:

1. **`enableAuth: true` but `mdm.config.auth` is missing.** The
   middleware runs but has no `getUser(c)` resolver, so every request
   still passes through. The warning payload names exactly what to
   configure.
2. **`enableAuth: false` explicitly.** The host opted out, probably
   because a parent router already authenticates every request. The
   warning is a one-line acknowledgement — grep-able in startup logs
   so operators can verify it is intentional.

Hosts that had been running without admin auth by accident will now
see a `warn`-level log at boot naming the missing piece. Hosts that
already pass `enableAuth: true` plus `config.auth` see no change.
Hosts that wrap OpenMDM in a parent router and authenticate upstream
should add `enableAuth: false` to opt out cleanly.

This is a major bump because the default behavior changes in a way
that affects the security posture of every deployment that did not
previously configure auth.

### `@openmdm/core` — minor

**Dashboard fallback assertions.** `mdm.dashboard.getStats(tenantId)`
previously forwarded the tenantId to a matching DB adapter method if
one existed, and silently discarded it otherwise. The Drizzle adapter
does not implement any of the tenant-scoped dashboard methods, so
`mdm.dashboard.getStats('acme')` silently returned fleet-wide stats
— a clean path to leaking another tenant's device counts onto the
page rendering for tenant A.

New helper `assertNoTenantScopeRequested(tenantId, methodName)` in
`packages/core/src/dashboard.ts` throws a descriptive error when a
caller passes a `tenantId` to a fallback path that cannot honor it.
Callers that want global stats pass `undefined` and everything keeps
working. Callers that want tenant stats get a loud error pointing at
the `DatabaseAdapter` method they need to implement. This is a
backstop, not a fix for the root cause — once core resources gain a
`tenantId` column the fallback paths can filter themselves and the
assertion becomes dead code.

Applied to all five dashboard methods: `getStats`,
`getDeviceStatusBreakdown`, `getEnrollmentTrend`,
`getCommandSuccessRates`, `getAppInstallationSummary`.

### New tests (126 → 154 total)

- **`packages/core/tests/tenant-isolation.pinning.test.ts`** (9 tests)
  — pinning tests that document the current (broken) state of tenant
  isolation and authorization enforcement at the manager layer. These
  tests intentionally assert *wrong* behavior as the baseline so a
  future refactor cannot silently make it worse. When the
  architectural fix lands, these tests break and are rewritten.
- **`packages/adapters/hono/tests/admin-auth-default.test.ts`**
  (5 tests) — locks in the `enableAuth: true` default and the two
  startup warning codes (`auth-enabled-but-not-configured` and
  `auth-explicitly-disabled`) so the footgun cannot silently return.
- **`packages/core/tests/tenant-isolation.pinning.test.ts`** also
  covers the dashboard backstop (6 tests): global stats still work
  with `undefined` tenantId; all five methods throw with a descriptive
  error when passed a tenantId on an adapter that cannot scope.

### New docs page

`docs/content/docs/proposals/tenant-rbac-audit.mdx` — the full audit:
file:line refs for every finding, what is fixed in this PR, what is
*not* fixed, the follow-up issues that would close the architectural
gap, and three realistic options for running OpenMDM in a multi-tenant
deployment *today* (one instance per tenant, shared instance with
host-side filtering via `metadata`, or wait for the architectural fix).

### Migration

Hosts that currently rely on `enableAuth` being false by default:

- **Recommended:** configure `mdm.config.auth` with a `getUser(c)`
  resolver and (optionally) `isAdmin(user)`. This is the path the
  docs always recommended.
- **Escape hatch:** pass `enableAuth: false` explicitly to
  `honoAdapter()`. You will get a startup warning, which is the
  point.

Nothing at the API surface changes — only the default for one option.
