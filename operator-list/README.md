# operator-list

ELT scripts that sync airline **operator** reference data into the
[Flight Tracker](https://api.flights.barcz.me) API. Data is prepared locally as
a CSV "sheet" and reconciled into the live API **without creating duplicates**.

This is deliberately a collection of TypeScript scripts — no NestJS, no HTTP
server, no framework. Node 24 runs the `.ts` files directly via native type
stripping, so there is no build step.

## Running

```bash
cp .env.dist .env                            # fill in FLIGHTS_EMAIL / FLIGHTS_PASSWORD (needs the "operations" role)
npm run sync:operators                       # dry-run: prints the create/update/skip plan, writes nothing
npm run sync:operators -- --apply            # actually write to the API
npm run sync:operators -- path/to/other.csv  # use a different sheet
npm run typecheck                            # tsc --noEmit
```

`config.ts` auto-loads `.env` if present (`process.loadEnvFile`), so running
`node src/sync-operators.ts` directly works too.

> Node type *stripping* (not transformation) is in effect: avoid TypeScript
> runtime-only constructs — no `enum`, no `namespace`, no constructor parameter
> properties (`constructor(public x: ...)`), no experimental decorators. They
> parse under `tsc` but throw at runtime. Use `as const` arrays for enums and
> explicit field declarations in classes. All relative imports must use explicit
> `.ts` extensions.

## Sync model

The sync is a **reconciliation**, run per domain (currently just operators).

Pipeline (`src/sync-operators.ts`): load sheet → sign in → fetch all existing
from the API → `buildPlan` → print → (with `--apply`) execute.

- **Match key is the ICAO code** (`icaoCode`), uppercased. That's how duplicates
  are avoided — the same operator is never created twice.
- `buildPlan` (`src/operator/operator.sync.ts`) classifies each desired operator:
  **create** (no match), **update** (match but differs), or **skip** (identical).
- **Updates are minimal and non-destructive.** Only columns actually filled in
  the CSV are considered, and only the *differing* fields go into the PATCH
  payload — so a sparse sheet never clobbers existing API data with
  blanks/defaults. Read-only/derived fields (`fleetSize`, `fleetTypes`) are never
  written.
- Array fields (e.g. `hubs`) are compared as **sets** (order-insensitive) to
  avoid false diffs.
- **Dry-run is the default.** Writes happen only with `--apply`, and apply
  continues past per-item failures, reporting a summary (and a non-zero exit if
  any failed).

## Layout

- `src/config.ts` — env loading + API base URL / credentials.
- `src/csv.ts` — zero-dependency CSV parser (handles quotes, escaped quotes,
  embedded commas/newlines).
- `src/api/client.ts` — `signIn()` (JWT) + `createClient(token)` authed fetch
  wrapper; throws `ApiError` with status + body.
- `src/api/operators.ts` — operator endpoints (`list` / `create` / `update`).
- `src/operator/operator.types.ts` — types/enums mirrored from the API schema.
- `src/operator/operator.csv.ts` — CSV row → validated `DesiredOperator` (only
  filled columns are set).
- `src/operator/operator.sync.ts` — `buildPlan`, the diff/reconcile logic.
- `sheets/operators.csv` — the working data sheet (often AI-generated). Columns
  match `CreateOperatorRequest`; `hubs` is whitespace/comma/semicolon-separated
  IATA codes in one cell.

## Auth

Writes require a user with the **operations** role.
`POST /api/v1/auth/sign-in` returns `{ accessToken, refreshToken }`; the access
token is sent as `Authorization: Bearer`. Tokens are short-lived but each script
run signs in fresh, so refresh isn't handled yet.

## Adding a new domain (e.g. airports)

Mirror the operator layout: a `<domain>.types.ts` (from `/api-json`), a
`<domain>.csv.ts` loader, a `<domain>.sync.ts` with `buildPlan`, an
`api/<domain>.ts`, and a `sync-<domain>.ts` CLI. Reuse `csv.ts` and
`api/client.ts`. Pick the natural unique key for the match (for operators it's
the ICAO code).
