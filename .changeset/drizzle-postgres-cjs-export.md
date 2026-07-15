---
'@openmdm/drizzle-adapter': patch
---

Ship a CJS build of `@openmdm/drizzle-adapter/postgres` so drizzle-kit can load it.

The release notes tell consumers to point their schema tooling at
`@openmdm/drizzle-adapter/postgres`, but the subpath was published ESM-only —
and drizzle-kit resolves schema files through a CJS `require()`, which failed
with `ERR_PACKAGE_PATH_NOT_EXPORTED`. So the one tool the table definitions
exist for could not read them, and `drizzle-kit push`/`generate` against a
schema file that re-exports this subpath was broken out of the box.

The postgres entry now also builds to `dist/postgres.cjs` with a matching
`require` export condition. Only this entry gets a CJS build: it depends
solely on `drizzle-orm` (which ships both formats), while the runtime entry
and `./schema` depend on ESM-only packages (`nanoid`, `@openmdm/core`) and
would fail at require-time regardless.
