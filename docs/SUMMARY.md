# Credit Card Fraud Detection Demo

## Overview

A Snowflake App Runtime (Next.js) application that simulates a credit card payment form for fraud detection demo purposes. Deployed on SPCS. Each submitted transaction is fraud-scored and persisted to Snowflake Postgres, then mirrored into Snowflake via pg_lake and visualized on a near-real-time map dashboard (Streamlit in Snowflake).

**Payment app URL:** https://mi5jie-sfseeurope-ereitberger-aws2.snowflakecomputing.app
**Dashboard:** Streamlit app `FRAUD_DEMO.PUBLIC.FRAUD_MAP_DASHBOARD` (see Analytics Pipeline & Dashboard below).

## Architecture at a glance

```
Payment form (Next.js/SPCS)
   -> POST /api/transactions  (fraud scoring: impossible-travel rule + Snowflake anomaly model)
   -> Postgres  transactions            (operational table)
   -> pg_incremental sequence pipeline  (append-only by id, pg_cron every 1 min)
   -> Postgres  transactions_lake       (pg_lake Iceberg mirror, managed storage; excludes PAN/CVC/PII)
   -> CATALOG_SOURCE = SNOWFLAKE_POSTGRES catalog integration (FRAUD_PG_LAKE_CATALOG, refresh 30s)
   -> Snowflake FRAUD_DEMO.PUBLIC.TRANSACTIONS_LAKE  (Iceberg table, AUTO_REFRESH)
   -> Streamlit-in-Snowflake dashboard (st.map, 15s auto-refresh)
```

End-to-end freshness ~60-90s (pg_cron 1-min floor + 30s catalog refresh + 15s app refresh).

## Features

- **Card type selection** — Visa and Mastercard, displayed as full-bleed card images
- **Transaction type selection** — E-commerce, Point of Sale, ATM (mandatory)
- **Cardholder name** — required text input
- **Card number** — randomly generated 16-digit number (formatted as groups of 4), editable
- **Expiry date** — randomly generated MM/YY (1-4 years in the future), editable
- **CVC** — randomly generated 3-digit code, editable
- **Billing location** — static dropdown with 15 city+country combinations
- **Submit** — validates card type, transaction type, and name; POSTs to `/api/transactions` to persist in Postgres; shows confirmation screen with masked card number
- **New Transaction** — resets form with fresh random values

## Tech Stack

- **Framework:** Next.js (Snowflake App Runtime)
- **UI:** shadcn/ui components + Tailwind CSS
- **Icons:** lucide-react (ShoppingCart, Store, Landmark, CheckCircle2)
- **Database:** Snowflake Postgres (`fraud_detection_db_demo`, STANDARD_M, 10GB)
- **PG Client:** `pg` npm package via `lib/postgres.ts`
- **Deployment:** SPCS via `snow app deploy` (CLI 3.22.0)

## Project Structure

```
credit_card_fraud_detection_demo/
├── app/
│   ├── page.tsx              # Entry page (renders PaymentForm)
│   ├── layout.tsx            # Root layout with app header
│   ├── globals.css           # Card selectors, form inputs, theme tokens
│   └── api/
│       ├── transactions/route.ts  # POST — persists form data to Postgres
│       ├── time/route.ts          # Template route
│       └── query/route.ts         # Template route
├── components/
│   ├── payment-form.tsx      # Main client component (all form logic)
│   ├── app-header.tsx        # Navigation bar
│   └── ui/                   # shadcn/ui primitives (Card, Button, etc.)
├── lib/
│   ├── constants.ts          # APP_TITLE, LOGO_SRC, CITY_COORDS, MERCHANT_CATEGORIES, fraud thresholds, haversineKm
│   ├── postgres.ts           # Postgres Pool + queryPostgres helper
│   ├── snowflake.ts          # querySnowflake / querySnowflakeLongRunning
│   └── utils.ts              # cn() helper
├── dashboard/                # Streamlit-in-Snowflake fraud map dashboard (Container Runtime)
│   ├── streamlit_app.py      # pydeck map, 24h time filter, fraud-only toggle, KPIs, 15s auto-refresh
│   ├── pyproject.toml        # PyPI deps (pydeck, snowpark, streamlit-autorefresh)
│   └── snowflake.yml         # SiS deploy manifest (runtime SYSTEM$ST_CONTAINER_RUNTIME_PY3_11)
├── .cortex/skills/feature-creation/  # /feature-creation intake+plan workflow + request template
├── public/
│   ├── visa-logo.png         # Visa card image
│   ├── master-card.png       # Mastercard image
│   └── icon.svg              # Browser favicon
├── .env.local                # PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD (local dev)
├── icon.svg                  # App profile icon (Snowflake metadata)
├── app.yml                   # App metadata (label, description, icon)
├── snowflake.yml             # Deployment config (database, schema, warehouse)
└── package.json              # Dependencies
```

## Deployment

- **Account:** SFSEEUROPE-EREITBERGER_AWS2
- **Database:** USER$EREITBERGER
- **Schema:** PUBLIC
- **Workspace:** USER$EREITBERGER.PUBLIC.SNOWFLAKE_APPS
- **Warehouse:** COMPUTE_WH

### Redeploy

```bash
cd /Users/ereitberger/dev_projects/credit_card_fraud_detection_demo
snow app deploy
```

### Local Development

```bash
npm run dev
# Opens at http://localhost:3000
```

## Validation Rules

| Field | Rule |
|-------|------|
| Card type | Must select Visa or Mastercard |
| Transaction type | Must select E-commerce, Point of Sale, or ATM |
| Name | Required (non-empty) |
| Card number | Auto-generated, editable (no format validation) |
| Expiry | Auto-generated, editable (no format validation) |
| CVC | Auto-generated, editable (no format validation) |
| City | Pre-selected from dropdown (always valid) |

## Postgres Database

### Instance Details

| Setting | Value |
|---------|-------|
| Instance | `fraud_detection_db_demo` |
| Host | `n5zx24aekjbujp2t3cv7shvcd4.sfseeurope-ereitberger-aws2.eu-central-1.aws.postgres.snowflake.app` |
| Port | 5432 |
| Database | postgres |
| User | snowflake_admin |
| Compute | STANDARD_M (1 core, 4GB) |
| Storage | 10 GB |
| Postgres version | 18 |
| Network policy | `PG_RULE_VPN` (uses `SECURITY_DB.NETWORK.PG_INGRESS_VPN` rule) |

### Table Schema

```sql
CREATE TABLE transactions (
  id                SERIAL PRIMARY KEY,
  card_type         VARCHAR(20)  NOT NULL,
  transaction_type  VARCHAR(20)  NOT NULL,
  cardholder_name   VARCHAR(200) NOT NULL,
  card_number       VARCHAR(19)  NOT NULL,
  expiry            VARCHAR(5)   NOT NULL,
  cvc               VARCHAR(4)   NOT NULL,
  billing_location  VARCHAR(200) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  amount            NUMERIC(10,2),
  merchant_category TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  fraud_flag        BOOLEAN,
  fraud_reason      TEXT,
  anomaly_score     DOUBLE PRECISION
);
-- Index supporting the impossible-travel lookup:
--   idx_txn_card_created btree (card_number, created_at DESC)
```

**Fraud scoring** (in `app/api/transactions/route.ts`, at insert time):
- Impossible-travel rule — compares against the card's most recent prior transaction using `latitude/longitude` + `created_at` (haversine speed > `IMPOSSIBLE_TRAVEL_KMH`).
- Anomaly model — calls Snowflake `FRAUD_DEMO.PUBLIC.FRAUD_MODEL!DETECT_ANOMALIES` on `amount` per `merchant_category`.
- Result persisted as `fraud_flag`, `fraud_reason`, `anomaly_score`.

### Connecting

```bash
# Via psql (uses ~/.pg_service.conf + ~/.pgpass)
psql "service=fraud_detection_db_demo connect_timeout=10"

# Query transactions
psql "service=fraud_detection_db_demo connect_timeout=10" -c "SELECT * FROM transactions;"
```

### Environment Variables (for the app)

Set in `.env.local` for local dev. For SPCS deployment, these need to be injected as container env vars or Snowflake secrets.

```
PG_HOST=n5zx24aekjbujp2t3cv7shvcd4.sfseeurope-ereitberger-aws2.eu-central-1.aws.postgres.snowflake.app
PG_PORT=5432
PG_DATABASE=postgres
PG_USER=snowflake_admin
PG_PASSWORD=<from ~/.pgpass>
```

## Analytics Pipeline & Dashboard

Near-real-time path from the operational Postgres table to a Snowflake-hosted map dashboard, built with pg_lake. The operational `transactions` table is a normal heap table; pg_lake surfaces only Iceberg tables to Snowflake, so an Iceberg mirror is kept in sync and exposed via a catalog integration.

### Components

| Layer | Object | Notes |
|-------|--------|-------|
| Iceberg mirror (PG) | `transactions_lake` | `USING iceberg`, managed storage. Carries only map-relevant columns; **excludes** `card_number`, `cvc`, `expiry`, `cardholder_name` (no PAN/PII in the lake). |
| Sync | `incremental.sync_transactions_lake` | pg_incremental **sequence pipeline**, append-only by `id`, scheduled by pg_cron every 1 min. |
| Catalog integration | `FRAUD_PG_LAKE_CATALOG` | `CATALOG_SOURCE = SNOWFLAKE_POSTGRES`, `REFRESH_INTERVAL_SECONDS = 30`. |
| Snowflake table | `FRAUD_DEMO.PUBLIC.TRANSACTIONS_LAKE` | Iceberg table over the catalog, `AUTO_REFRESH = TRUE`. Source for the dashboard. |
| Dashboard | Streamlit `FRAUD_DEMO.PUBLIC.FRAUD_MAP_DASHBOARD` | Streamlit-in-Snowflake, **Container Runtime** (`SYSTEM$ST_CONTAINER_RUNTIME_PY3_11`), compute pool `SYSTEM_COMPUTE_POOL_CPU`, PyPI via `PYPI_ACCESS` EAI. |

### Dashboard

`dashboard/streamlit_app.py`: `st.map` scatter map (red = fraud, blue = legitimate) with a 24h time-window slider, fraud-only toggle, KPIs (total / fraud / rate), and 15s auto-refresh. Per-transaction detail (id, amount, fraud reason) is in a Table expander, since `st.map` has no hover popups. Reads the Snowflake Iceberg table via the embedded Snowpark session (`get_active_session`), with a local named-connection fallback for `streamlit run`.

Deploy:
```bash
cd dashboard
snow streamlit deploy --replace \
  --connection ereitberger-demo-account-aws-eu-frankfurt --role ACCOUNTADMIN \
  --database FRAUD_DEMO --schema PUBLIC --warehouse COMPUTE_WH
```

### Managing the sync pipeline
```sql
-- inspect
SELECT * FROM incremental.sequence_pipelines;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- run now / reset progress / tear down
CALL incremental.execute_pipeline('sync_transactions_lake');
CALL incremental.reset_pipeline('sync_transactions_lake');
CALL incremental.drop_pipeline('sync_transactions_lake');
```

### Gotchas / decisions
- **folium does NOT work in SiS** — it loads Leaflet/JS from external CDNs that the Snowsight iframe CSP blocks (map renders blank / shows "Make this Notebook Trusted"). Use `st.map` (native, simplest) or `st.pydeck_chart` (for hover tooltips) — both use deck.gl bundled in Streamlit (same-origin, CSP-safe). This dashboard uses `st.map`.
- **`st.pydeck_chart` kwargs** — if you switch to pydeck for tooltips, avoid `height=`/`use_container_width=` on the deployed Streamlit version; they can raise `TypeError` and blank the map. Call `st.pydeck_chart(deck)` plain.
- **Snowflake connection name** is `ereitberger-demo-account-aws-eu-frankfurt` (not the account id). pg_lake / catalog-integration / SiS deploy steps need `ACCOUNTADMIN`.
- **pg_incremental v1.5** uses `source_table_name` (not `sequence_name`) for `create_sequence_pipeline`.
- **Auto-refresh in SiS** \u2014 use native `st.fragment(run_every=...)`, not the `streamlit-autorefresh` component (its frontend is unreliable under the Snowsight CSP, like folium).\n- **Overlapping points** \u2014 many transactions share identical city coordinates; `st.map` stacks them into one dot, so the app adds small lat/lon jitter to make co-located points visible.\n- **Cost**: the SiS compute pool bills while the app container is up; the catalog auto-refresh (Snowpipe) runs continuously. Suspend the pool when idle and/or raise `REFRESH_INTERVAL_SECONDS`.

## Troubleshooting — Postgres Setup

### DNS not resolving for a new instance

After `CREATE POSTGRES INSTANCE`, the hostname returns NXDOMAIN for 5-10 minutes while Snowflake provisions DNS records. The Snowflake SQL reports state=READY before DNS propagates. Wait and retry — use `host <hostname>` to check resolution.

### Wrong IP in network policy (VPN)

When connected to the Snowflake VPN (`corp-vpn.snowflake.com`), the public egress IP is the **Gateway IP** shown in the VPN client (e.g. `57.133.204.194`), NOT the IP from `api.ipify.org` or `curl ifconfig.me`. The VPN's assigned IP (`172.20.x.x`) is private/internal.

The existing `PG_RULE_VPN` policy (in `SECURITY_DB.NETWORK`) already contains the correct Snowflake VPN CIDR ranges. Reuse it for any new Postgres instances instead of creating a new policy:

```sql
ALTER POSTGRES INSTANCE <name> SET NETWORK_POLICY = 'PG_RULE_VPN';
```

### Network rules cannot be created in personal databases

`CREATE NETWORK RULE` fails in `USER$<name>` databases. Use a standard database like `SECURITY_NETWORK_DB` or `SECURITY_DB` instead.

### psql connection timeout (no network policy)

If `psql` hangs, the instance has no network policy allowing your IP. Always attach a policy before attempting to connect. Use `connect_timeout=10` to fail fast instead of hanging for minutes.
