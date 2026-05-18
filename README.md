# Psyche

Self-hosted full-stack app scaffolded as a pnpm workspace.

## Stack

- Frontend: Vite, React, TanStack Query, TanStack Router, CSS modules
- Backend: Fastify, Drizzle ORM, better-sqlite3
- Shared: Zod API schemas and inferred TypeScript types

## Workspace

```txt
apps/web       Vite React frontend
apps/api       Fastify API and SQLite database access
packages/shared  Shared Zod schemas and API types
```

The initial app surface is intentionally minimal: the frontend checks the backend health endpoint, and domain features can be added on top of the shared API contract pattern.

## Development

```sh
pnpm install
pnpm dev
```

The frontend runs at `http://127.0.0.1:5173`.
The API runs at `http://127.0.0.1:4000`.

## Useful Scripts

```sh
pnpm typecheck
pnpm build
pnpm db:generate
pnpm db:migrate
```
