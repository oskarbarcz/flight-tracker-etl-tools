# flight-tracker-etl-tools

Tooling for preparing and loading **reference data** into the
[Flight Tracker](https://api.flights.barcz.me) production API (OpenAPI at
`/api-json`).

Flight Tracker is used by flight-sim users who shouldn't have to hand-enter
reference data — airports, operators, aircraft, and the illustrations that go
with them. This repo is where that data is generated and curated locally, then
**synced** into the live API without creating duplicates.

It is deliberately a collection of small, single-purpose tools rather than one
long-running app. Each tool lives in its own subdirectory with its own
dependencies, and each does one job: build a dataset, or load a dataset.

## Tools

| Subdirectory | What it does |
| --- | --- |
| [`operator-list/`](operator-list/README.md) | TypeScript ELT scripts that reconcile CSV "sheets" of reference data (currently airline **operators**) into the Flight Tracker API — create / update / skip, dry-run by default. |
| [`aircraft-illustration-generator/`](aircraft-illustration-generator/README.md) | Generates clean, catalog-style side-view aircraft illustrations from a CSV of airframes using the OpenAI image API. |

See each subdirectory's README for setup and usage.
