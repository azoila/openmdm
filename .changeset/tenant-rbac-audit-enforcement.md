---
'@openmdm/core': minor
'@openmdm/drizzle-adapter': minor
---

Enforce tenant isolation, RBAC, and audit logging — `mdm.withContext(...)`.

`TenantManager`, `AuthorizationManager`, and `AuditManager` all existed, and core never
called any of them. The default behaviour of every manager method was therefore: return
**every tenant's** data, check **no** permissions, and record **nothing**. The test suite
pinned this as known-broken (`tenant-isolation.pinning.test.ts`) rather than fixing it.

**`mdm.withContext({ tenantId, userId })`** returns a scoped instance with the same manager
APIs, on which all three concerns are enforced on every call:

```typescript
const scoped = mdm.withContext({ tenantId: 'acme', userId: user.id });
await scoped.devices.list();     // only Acme's devices — filtered in SQL
await scoped.devices.delete(id); // 'delete:devices' enforced, and audited
```

The **root instance stays unscoped by design** — it is the system caller (enrollment,
delivery sweeps, single-tenant embeds), where there is no user to authorize and no tenant to
infer. Anything driven by a user request should go through a scoped instance.

Three properties worth calling out:

- **A cross-tenant read is indistinguishable from a miss.** Fetching another tenant's device
  id returns `null`, and mutating it raises `NotFound` — never a distinct authorization
  error, which would confirm the id exists elsewhere.
- **Tenant scoping fails closed.** A scoped instance built on an adapter that does not
  declare `supportsTenantScoping` throws at construction rather than silently ignoring the
  filter and serving every tenant's rows.
- **Failed attempts are audited, not just successful ones.** A denied permission and a
  cross-tenant reach are both recorded — an audit trail containing only successes is not much
  of a trail. Reads are not audited by default (they would drown the table).

`Device`, `Policy`, `Application`, `Group`, and `Command` gain an optional `tenantId`; the
Drizzle adapter adds a nullable `tenant_id` column (indexed) to each table, persists it on
create, and filters on it. Existing single-tenant rows keep `NULL` and behave exactly as
before — no backfill required.
