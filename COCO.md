# COCO.md — Credit Card Fraud Detection Demo

Project context for Cortex Code. Auto-loaded each session.

## What this is
A Snowflake App Runtime (Next.js) app simulating a credit-card payment form for a fraud-detection demo. Deployed on SPCS; persists submitted transactions to a Snowflake Postgres instance.

- **Live URL:** https://mi5jie-sfseeurope-ereitberger-aws2.snowflakecomputing.app
- **Deeper docs:** see `SUMMARY.md` (full architecture, DB schema, troubleshooting) and `README.md` (template concepts). Read those before making non-trivial changes.

## Tech stack
- Next.js 16 (App Router, standalone output) on Snowflake App Runtime
- React 19, shadcn/ui + Tailwind v4, lucide-react
- Snowflake Postgres via `pg` (`lib/postgres.ts`); Snowflake Node SDK via `lib/snowflake.ts`
- TypeScript, Vitest for tests

## Key files
- `components/payment-form.tsx` — main client component, all form logic
- `app/api/transactions/route.ts` — POST handler; writes form data to Postgres
- `lib/postgres.ts` — PG Pool + `queryPostgres` helper
- `lib/snowflake.ts` — `querySnowflake` / long-running variant
- `lib/constants.ts` — app title + logo (branding)
- `app/globals.css` — theme tokens, card selectors, form styling
- `snowflake.yml` / `app.yml` — deployment + app metadata

## Fraud map dashboard (near-real-time)
A separate Streamlit-in-Snowflake (Container Runtime) app visualizes transactions on a native map (`st.map`) with a 24h time filter and fraud-only toggle, auto-refreshing every 15s; per-transaction detail is in a Table expander. Lives in `dashboard/` (`streamlit_app.py`, `pyproject.toml`, `snowflake.yml`); no Docker.

Map gotcha: folium does NOT work in SiS — it loads Leaflet/JS from external CDNs that the Snowsight iframe CSP blocks (map renders blank / shows "Make this Notebook Trusted"). Use pydeck/deck.gl (bundled in Streamlit, same-origin) or st.map instead.

Data pipeline (Postgres -> Snowflake, ~60-90s freshness):
1. `transactions_lake` — pg_lake Iceberg mirror of `transactions` (excludes PAN/CVC/PII), managed storage.
2. `incremental.sync_transactions_lake` — pg_incremental sequence pipeline (append-only by `id`), pg_cron every minute. Manage via `incremental.execute_pipeline/reset_pipeline/drop_pipeline`.
3. `FRAUD_PG_LAKE_CATALOG` — catalog integration `CATALOG_SOURCE = SNOWFLAKE_POSTGRES`, `REFRESH_INTERVAL_SECONDS=30`.
4. `FRAUD_DEMO.PUBLIC.TRANSACTIONS_LAKE` — Snowflake Iceberg table (`AUTO_REFRESH=TRUE`) the dashboard reads.

Deploy: `cd dashboard && snow streamlit deploy --replace --connection ereitberger-demo-account-aws-eu-frankfurt --role ACCOUNTADMIN`. App: `FRAUD_DEMO.PUBLIC.FRAUD_MAP_DASHBOARD`, compute pool `SYSTEM_COMPUTE_POOL_CPU`, PyPI via `PYPI_ACCESS` EAI.

Notes: Snowflake connection name is `ereitberger-demo-account-aws-eu-frankfurt` (not the account id); pg_lake/SPCS work needs `ACCOUNTADMIN`. pg_incremental v1.5 uses `source_table_name` (not `sequence_name`).

## Commands
```bash
npm run dev      # local dev at http://localhost:3000
npm run build    # production build
npm run test     # vitest
snow app deploy  # deploy to SPCS
```

## Building features
Feature work in this project uses the `/feature-creation` skill (`.cortex/skills/feature-creation/`): it presents its bundled `FEATURE_REQUEST_TEMPLATE.md`, asks clarifying questions, then produces a plan for approval before coding. Invoke it whenever adding or changing a feature.

## Conventions / gotchas
- Server-only helpers: client components must call API routes, not `querySnowflake()`/`queryPostgres()` directly.
- Pages/routes that hit a DB need `export const dynamic = "force-dynamic"`.
- Local dev reads PG creds from `.env.local` (gitignored); never commit secrets.
- Postgres network access uses policy `PG_RULE_VPN`. On Snowflake VPN, the allowed egress IP is the VPN client **Gateway IP**, not `ifconfig.me`. See SUMMARY.md → Troubleshooting.
- Deployment target: `USER$EREITBERGER.PUBLIC`, warehouse `COMPUTE_WH`, workspace `USER$EREITBERGER.PUBLIC.SNOWFLAKE_APPS`.
