---
'@openmdm/core': minor
'@openmdm/cli': minor
'@openmdm/drizzle-adapter': patch
---

Make `openmdm generate` emit a schema that actually works.

**The generated SQL never ran.** Tables were emitted in declaration order, and `mdm_devices` —
declared first — carries a foreign key to `mdm_policies`, declared after it. Postgres rejected
the very first statement with `relation "mdm_policies" does not exist`. The SQL this generator
produced had never successfully built a database, and nothing caught it because nothing ever
executed it. Tables are now topologically sorted by their foreign-key dependencies (all three
dialects), and a new e2e test pipes the generated schema into a real Postgres on every CI run.

**The declared schema was missing tables and columns the adapter requires.** `mdmSchema` in
core is the single source the CLI generates from, and it had drifted from the runtime schema:
no `mdm_enrollment_challenges` (required for device-pinned-key enrollment), no
`mdm_policy_versions`, and missing `public_key`, `enrollment_method`, `tenant_id`,
`applied_policy_version`, and every command-durability column. Consumers who ran
`openmdm generate` got a schema the adapter could not run against, and hand-patched the
generated file — carrying a "do not regenerate this" warning in their own repo.

A **parity test** now asserts every runtime table and column is declared, so this drifts into a
red build rather than a support ticket.

**`openmdm migrate` no longer prints stale hand-written SQL.** It shipped a ~180-line blob
maintained by hand inside the command, which declared `VARCHAR(255)` primary keys where the
schema says `varchar(36)` and omitted four tables entirely. Both the schema and the rollback are
now derived from `mdmSchema`, so they cannot drift again. (The command still only prints SQL and
keeps no migration history — use `openmdm generate` with drizzle-kit for that.)
