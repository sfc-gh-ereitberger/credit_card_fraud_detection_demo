# Real-Time Fraud Detection — Architecture

## Architecture Diagram

```
                         +-------------------+
                         |   Next.js App     |
                         | (payment form +   |
                         |  dashboard)       |
                         +--------+----------+
                                  |
                     POST /predict (pre-commit)
                     {CARD_NUMBER, AMOUNT, MERCHANT_CATEGORY, LAT, LON}
                                  |
                                  v
                  +-------------------------------+
                  |   SPCS Ingress (HTTPS)        |
                  |   mn5jie-...snowflakecomputing.app/predict
                  |   Auth: Snowflake PAT         |
                  +-------------------------------+
                                  |
                    feature_sources_per_function
                    lookup CARD_NUMBER
                                  |
                  +---------------+---------------+
                  |                               |
                  v                               v
    +-------------------------+     +-------------------------+
    | Online Feature Store    |     | ML Inference Service    |
    | (Postgres-backed, 10s)  |     | (XGBoost on SPCS)      |
    |                         |     |                         |
    | Returns:                |     | Input: 10 columns       |
    | HOME_LAT, HOME_LON,    |     | Output: class (0|1)     |
    | LAST_LAT, LAST_LON,    |     +-------------------------+
    | AVG_AMOUNT, TXN_COUNT  |                |
    +-------------------------+                |
              ^                                v
              |                    fraud_flag + fraud_reason
              |                                |
              |                                v
              |                   +------------------------+
              |                   |  Postgres INSERT       |
              |                   |  (system of record)    |
              |                   +------------------------+
              |                                |
              |                     Managed Mirror (~30s)
              |                                |
              |                                v
              |                   +------------------------+
              |                   | FRAUD_DEMO_OLTP.PUBLIC |
              |                   | .TRANSACTIONS          |
              |                   | (Snowflake table)      |
              |                   +------------------------+
              |                                |
              |                     Dynamic Table (~1 min)
              |                                |
              |                                v
              |                   +------------------------+
              +-------------------| CARD_FEATURES          |
                  sync (10s)      | (1 row per card)       |
                                  +------------------------+
```

## Flow (step by step)

1. User submits a transaction in the app.
2. App POSTs `CARD_NUMBER` + charge attributes to the SPCS `/predict` endpoint.
3. SPCS ingress authenticates via PAT, identifies `CARD_NUMBER` as the FeatureView join key.
4. Online Feature Store returns the card's state (home/last location, avg amount, txn count) in ~10ms.
5. Gateway merges 5 request columns + 6 looked-up columns = 10 model inputs.
6. XGBoost returns class: 0 (legit) or 1 (fraud).
7. App sets `fraud_flag` based on the score.
8. App INSERTs the transaction (with verdict) to Postgres.
9. Managed mirror replicates the row to Snowflake (~30s).
10. `CARD_FEATURES` Dynamic Table refreshes (~1 min), online store syncs (~10s).
11. Next scoring for the same card sees updated history.

## Snowflake Components

| Component | Product | Purpose |
|---|---|---|
| `FRAUD_DEMO_OLTP.PUBLIC.TRANSACTIONS` | Managed Mirror | Continuous CDC from Postgres to Snowflake |
| `FRAUD_ML.FEATURE_STORE.CARD_FEATURES` | Dynamic Table | Card-level aggregation (home, last, avg, count) |
| `CARD_FRAUD_FEATURES` (FeatureView) | Feature Store | Defines features + online serving config |
| Online service | Feature Store Online (Postgres) | Low-latency feature lookup at scoring time |
| `FRAUD_XGBOOST/V1` | Model Registry | Versioned XGBoost model |
| `FRAUD_DETECTION_SVC` | ML Inference Service (SPCS) | REST /predict with auto feature lookup |
| `ML_ONLINE_CPU_POOL` | Compute Pool | Runs the model container |
| Ingress URL | SPCS Ingress | Public HTTPS endpoint |
| PAT | Snowflake OAuth | External client authentication |

## Key Design Decisions

- **Card-keyed, pre-commit**: scoring happens before the transaction is written, using pre-computed card state that already exists in the online store.
- **Feature Store as single source of truth**: same FeatureView serves training (offline) and inference (online).
- **No custom model wrapper (prototype)**: XGBoost consumes raw features; trees learn interactions. Cross-feature derivation (haversine, time-since-last) deferred.
- **Graceful degradation**: if `/predict` fails, the transaction still saves with `scoring_error` — app stays operational.

## How Feature Store Online + Inference Service + XGBoost Work Together

```
Request: {CARD_NUMBER, AMOUNT, MERCHANT_CATEGORY, LAT, LON}
         |
         v
+--------------------------------------------------+
|  INFERENCE SERVICE (SPCS container)              |
|                                                  |
|  1. Sees CARD_NUMBER in the request              |
|  2. Knows from feature_sources_per_function      |
|     that CARD_FRAUD_FEATURES FeatureView         |
|     is keyed by CARD_NUMBER                      |
|                                                  |
|     +----------------------------------------+   |
|     | FEATURE STORE ONLINE (Postgres)        |   |
|     |                                        |   |
|     | SELECT HOME_LAT, HOME_LON, LAST_LAT,  |   |
|     |        LAST_LON, AVG_AMOUNT, TXN_COUNT |   |
|     | WHERE CARD_NUMBER = '4111...'          |   |
|     |                                        |   |
|     | Returns 6 columns in ~10ms             |   |
|     +----------------------------------------+   |
|                                                  |
|  3. Merges:                                      |
|     request columns:  AMOUNT, MERCHANT_CATEGORY, |
|                       LATITUDE, LONGITUDE        |
|     + looked-up:      HOME_LAT, HOME_LON,       |
|                       LAST_LAT, LAST_LON,        |
|                       AVG_AMOUNT, TXN_COUNT      |
|     = 10 columns                                 |
|                                                  |
|     +----------------------------------------+   |
|     | XGBOOST MODEL (from Model Registry)    |   |
|     |                                        |   |
|     | Input: 10 columns (same as training)   |   |
|     | Output: class 0 or 1                   |   |
|     +----------------------------------------+   |
|                                                  |
|  4. Returns {"output_feature_0": 0}             |
+--------------------------------------------------+
```

### The glue: `feature_sources_per_function`

The binding between these three happens at service creation time:

```python
mv.create_service(
    service_name="FRAUD_DETECTION_SVC",
    service_compute_pool="ML_ONLINE_CPU_POOL",
    ingress_enabled=True,
    feature_sources_per_function={"predict": [card_fv]},
)
```

This tells the inference service: "When someone calls `predict`, look at which columns in the request match a FeatureView join key. Use that key to fetch the remaining columns from the online store. Then pass everything to the model."

### Each component's single job

| Component | Knows about | Does |
|---|---|---|
| **Feature Store Online** | Card data (synced from CARD_FEATURES every 10s) | Key-value lookup: card_number -> 6 feature values |
| **Inference Service** | The model's expected input + which FeatureView to consult | Orchestrates: extract key, fetch features, merge, call model, return |
| **XGBoost model** | 10 numeric columns -> fraud/legit | Pure math: takes numbers, returns class. Knows nothing about cards, Postgres, or feature stores |

The model is deliberately dumb -- it just does math on numbers. The inference service handles all the plumbing (auth, feature fetching, merging). The online store handles data freshness. Clean separation.

## Deferred Enhancements

- Point-in-time-correct training set (leak-free windows)
- Custom model wrapper with SHAP explanations
- Explicit velocity/distance features
- Label upgrade (analyst confirmations instead of rule-derived fraud_flag)
- ML Gateway for A/B testing model versions

## Resources
- https://www.snowflake.com/en/developers/guides/build-real-time-ml-inference-with-feature-store/