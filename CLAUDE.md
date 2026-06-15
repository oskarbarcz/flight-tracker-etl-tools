# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A data inserter / sync tool for the **Flight Tracker** production API (`https://api.flights.barcz.me`, OpenAPI at `/api-json`). The flight tracker is used by flight-sim users who shouldn't have to hand-enter reference data (airports, operators, etc.). This repo prepares that data locally as CSV "sheets" and **syncs** it into the live API without creating duplicates.

It is deliberately a collection of **TypeScript scripts**, not a long-running app/server. There is no NestJS, no HTTP server, no framework — just scripts run directly under Node 24.

## Code style

**Do not write code comments.** No inline `//` comments, no `/* */` blocks, no JSDoc/docstring banners on functions, types, or constants. Write code that explains itself the way a senior engineer does: clear names, small focused functions, and types that make intent obvious. If a piece of logic feels like it needs a comment to be understood, prefer renaming, extracting a well-named function, or restructuring it instead. The only acceptable exceptions are content the tooling requires (e.g. a shebang) — never explanatory prose.

## Running

Node 24 runs `.ts` files directly via native type stripping — **no build step, no ts-node, no bundler**.

```bash
cp .env.example .env          # fill in FLIGHTS_EMAIL / FLIGHTS_PASSWORD (needs the "operations" role)
npm run sync:operators        # dry-run: prints the create/update/skip plan, writes nothing
npm run sync:operators -- --apply           # actually write to the API
npm run sync:operators -- path/to/other.csv # use a different sheet
npm run typecheck             # tsc --noEmit
```

`config.ts` auto-loads `.env` if present (`process.loadEnvFile`), so direct `node src/sync-operators.ts` works too.

> Node type *stripping* (not transformation) is in effect: **avoid TypeScript runtime-only constructs** — no `enum`, no `namespace`, no constructor parameter properties (`constructor(public x: ...)`), no experimental decorators. They parse under `tsc` but throw at runtime. Use `as const` arrays for enums and explicit field declarations in classes. All relative imports must use explicit `.ts` extensions.

## Sync model (the important part)

The sync is a **reconciliation**, run per domain. Current domains: **operators** (`src/operator/`). Airports and others will follow the same shape.

Pipeline (`src/sync-operators.ts`): load sheet → sign in → fetch all existing from API → `buildPlan` → print → (with `--apply`) execute.

- **Match key is the ICAO code** (`icaoCode`), uppercased. That's how duplicates are avoided — the same operator is never created twice.
- `buildPlan` (`operator/operator.sync.ts`) classifies each desired operator: **create** (no match), **update** (match but differs), or **skip** (identical).
- **Updates are minimal and non-destructive.** Only columns actually filled in the CSV are considered, and only the *differing* fields go into the PATCH payload — so a sparse sheet never clobbers existing API data with blanks/defaults. Read-only/derived fields (`fleetSize`, `fleetTypes`) are never written.
- Array fields (e.g. `hubs`) are compared as **sets** (order-insensitive) to avoid false diffs.
- **Dry-run is the default.** Writes happen only with `--apply`, and apply continues past per-item failures, reporting a summary (and a non-zero exit if any failed).

## Layout

- `src/config.ts` — env loading + API base URL / credentials.
- `src/csv.ts` — zero-dependency CSV parser (handles quotes, escaped quotes, embedded commas/newlines).
- `src/api/client.ts` — `signIn()` (JWT) + `createClient(token)` authed fetch wrapper; throws `ApiError` with status + body.
- `src/api/operators.ts` — operator endpoints (`list`/`create`/`update`).
- `src/operator/operator.types.ts` — types/enums mirrored from the API schema.
- `src/operator/operator.csv.ts` — CSV row → validated `DesiredOperator` (only filled columns are set).
- `src/operator/operator.sync.ts` — `buildPlan`, the diff/reconcile logic.
- `sheets/operators.csv` — the working data sheet (often AI-generated). Columns match `CreateOperatorRequest`; `hubs` is whitespace/comma/semicolon-separated IATA codes in one cell.

## Adding a new domain (e.g. airports)

Mirror the operator layout: a `<domain>.types.ts` (from `/api-json`), a `<domain>.csv.ts` loader, a `<domain>.sync.ts` with `buildPlan`, an `api/<domain>.ts`, and a `sync-<domain>.ts` CLI. Reuse `csv.ts` and `api/client.ts`. Pick the natural unique key for the match (for operators it's ICAO code).

## Auth

Writes require a user with the **operations** role. `POST /api/v1/auth/sign-in` returns `{ accessToken, refreshToken }`; the access token is sent as `Authorization: Bearer`. Tokens are short-lived but each script run signs in fresh, so refresh isn't handled yet.
