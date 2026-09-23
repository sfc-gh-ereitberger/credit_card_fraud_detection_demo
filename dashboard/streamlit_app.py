"""
Fraud Map Dashboard - Streamlit in Snowflake (Container Runtime).

Reads FRAUD_DEMO.PUBLIC.TRANSACTIONS_LAKE (a pg_lake Iceberg mirror of the
Postgres transactions table, surfaced to Snowflake via a SNOWFLAKE_POSTGRES
catalog integration). Plots transactions on a map over a selectable time
window, with a fraud-only filter, and auto-refreshes so newly submitted
transactions appear as the pipeline syncs them.

Map uses st.map (Streamlit's native map): deck.gl ships bundled inside Streamlit
(same-origin), so it renders behind the Snowsight CSP. folium was avoided
because it loads Leaflet/JS from external CDNs, which the SiS iframe CSP blocks.
Per-transaction detail is available in the Table expander (st.map has no popups).

Data access uses the embedded Snowpark session when hosted in Snowflake, and
falls back to a local named connection for `streamlit run`.
"""

import random

import pandas as pd
import streamlit as st

TABLE = "FRAUD_DEMO.PUBLIC.TRANSACTIONS_LAKE"
REFRESH_SECONDS = 15
FRAUD_COLOR = "#c0392b"  # red
LEGIT_COLOR = "#2980b9"  # blue

st.set_page_config(page_title="Fraud Map Dashboard", page_icon="map", layout="wide")


@st.cache_resource
def get_session():
    """Embedded Snowpark session when hosted in SiS; local connection otherwise."""
    try:
        from snowflake.snowpark.context import get_active_session

        return get_active_session()
    except Exception:
        import os

        from snowflake.snowpark import Session

        name = os.environ.get("SNOWFLAKE_CONNECTION_NAME")
        builder = Session.builder
        if name:
            builder = builder.config("connection_name", name)
        return builder.create()


@st.cache_data(ttl=REFRESH_SECONDS)
def load_transactions(hours: int, fraud_only: bool) -> pd.DataFrame:
    where = [f"created_at >= DATEADD('hour', -{int(hours)}, CURRENT_TIMESTAMP())"]
    if fraud_only:
        where.append("fraud_flag = TRUE")
    sql = f"""
        SELECT id, created_at, billing_location, latitude, longitude, amount,
               merchant_category, card_type, transaction_type, fraud_flag, fraud_reason
        FROM {TABLE}
        WHERE {' AND '.join(where)}
        ORDER BY created_at DESC
    """
    df = get_session().sql(sql).to_pandas()
    df.columns = [c.lower() for c in df.columns]
    if not df.empty:
        df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
        df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")
        df["amount"] = pd.to_numeric(df["amount"], errors="coerce")
        df["fraud_flag"] = df["fraud_flag"].fillna(False).astype(bool)
    return df


def map_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Rows with valid coordinates plus a per-point color column for st.map.

    Many transactions share the exact city coordinates, which would stack into a
    single dot; add a small jitter (~a few km) so co-located points are visible.
    """
    plot = df.dropna(subset=["latitude", "longitude"]).copy()
    n = len(plot)
    plot["latitude"] = plot["latitude"] + [random.uniform(-0.15, 0.15) for _ in range(n)]
    plot["longitude"] = plot["longitude"] + [random.uniform(-0.15, 0.15) for _ in range(n)]
    plot["color"] = plot["fraud_flag"].map(lambda f: FRAUD_COLOR if f else LEGIT_COLOR)
    return plot


# --- UI ---
st.title("Credit Card Transaction Fraud Map")

with st.sidebar:
    st.header("Filters")
    st.slider("Time window (hours)", min_value=1, max_value=168, value=24, key="hours")
    st.checkbox("Fraudulent only", value=False, key="fraud_only")
    st.caption(f"Auto-refreshes every {REFRESH_SECONDS}s. Source: {TABLE}")


@st.fragment(run_every=REFRESH_SECONDS)
def render_dashboard():
    hours = st.session_state["hours"]
    fraud_only = st.session_state["fraud_only"]
    try:
        df = load_transactions(hours, fraud_only)
    except Exception as e:
        st.error(f"Failed to load transactions: {e}")
        return

    total = len(df)
    fraud_n = int(df["fraud_flag"].sum()) if total else 0
    rate = (fraud_n / total * 100) if total else 0.0

    c1, c2, c3 = st.columns(3)
    c1.metric("Transactions", f"{total:,}")
    c2.metric("Fraudulent", f"{fraud_n:,}")
    c3.metric("Fraud rate", f"{rate:.1f}%")

    if total == 0:
        st.info("No transactions in the selected window.")
        return
    st.map(map_frame(df), latitude="latitude", longitude="longitude", color="color", size=40)
    st.caption("Red = fraud, blue = legitimate. Per-transaction detail is in the table below.")
    with st.expander("Table"):
        st.dataframe(df, hide_index=True)


render_dashboard()
