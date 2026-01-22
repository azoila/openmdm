---
"@openmdm/cli": minor
"@openmdm/drizzle-adapter": patch
---

feat(cli): add schema generator command (better-auth style)

- Add `openmdm generate` command for generating database schemas
- Support Drizzle ORM schema generation (PostgreSQL, MySQL, SQLite)
- Support raw SQL schema generation (PostgreSQL, MySQL, SQLite)
- Interactive prompts for adapter and provider selection
- Resolves drizzle-kit ESM compatibility by generating schema files users run with their own tooling

Migration workflow now follows better-auth pattern:
1. `npx openmdm generate --adapter drizzle --provider pg`
2. `npx drizzle-kit generate`
3. `npx drizzle-kit migrate`
