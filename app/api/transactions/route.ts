import { queryPostgres } from "@/lib/postgres"
import {
  MERCHANT_CATEGORIES,
  MERCHANT_CATEGORY_CODES,
  FRAUD_PROBABILITY_THRESHOLD,
  type MerchantCategory,
} from "@/lib/constants"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

// SPCS inference service (created by setup_realtime_fraud_feature_store.ipynb).
const FRAUD_PREDICT_URL = process.env.FRAUD_PREDICT_URL
const FRAUD_PREDICT_TOKEN = process.env.FRAUD_PREDICT_TOKEN

interface ScoreResult {
  fraud_flag: boolean
  fraud_reason: string | null
  anomaly_score: number | null
}

/**
 * Score a transaction pre-commit via the SPCS inference service.
 *
 * Sends CARD_NUMBER (lookup key) + charge attributes. The service auto-fetches
 * card-state features from the online Feature Store, runs XGBoost, returns class.
 */
async function scoreFraud(
  cardNumber: string,
  category: MerchantCategory,
  amount: number,
  lat: number | null,
  lon: number | null
): Promise<{ score: number | null }> {
  if (!FRAUD_PREDICT_URL || !FRAUD_PREDICT_TOKEN) {
    throw new Error(
      "FRAUD_PREDICT_URL / FRAUD_PREDICT_TOKEN not set — run the setup notebook and configure the SPCS ingress endpoint."
    )
  }

  const body = {
    dataframe_split: {
      index: [0],
      columns: ["CARD_NUMBER", "AMOUNT", "MERCHANT_CATEGORY", "LATITUDE", "LONGITUDE"],
      data: [[cardNumber, amount, MERCHANT_CATEGORY_CODES[category], lat ?? 0, lon ?? 0]],
    },
  }

  const res = await fetch(FRAUD_PREDICT_URL, {
    method: "POST",
    headers: {
      Authorization: `Snowflake Token="${FRAUD_PREDICT_TOKEN}"`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`predict endpoint returned ${res.status}: ${await res.text()}`)
  }

  // Response: {"data": [[row_idx, {"output_feature_0": 0|1}]]}
  const json = (await res.json()) as { data?: [number, Record<string, unknown>][] }
  const row = json.data?.[0]
  if (!row) return { score: null }
  const output = row[1]
  const score = typeof output === "object" && output !== null
    ? Number((output as Record<string, unknown>).output_feature_0 ?? 0)
    : typeof output === "number" ? output : null
  return { score }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      card_type,
      transaction_type,
      cardholder_name,
      card_number,
      expiry,
      cvc,
      billing_location,
      merchant_category,
      amount,
      latitude,
      longitude,
    } = body

    if (
      !card_type || !transaction_type || !cardholder_name || !card_number ||
      !expiry || !cvc || !billing_location || !merchant_category || amount == null
    ) {
      return Response.json({ error: "All fields are required" }, { status: 400 })
    }

    // Validate merchant_category against the allow-list (prevents SQL injection into the model call)
    if (!MERCHANT_CATEGORIES.includes(merchant_category)) {
      return Response.json({ error: "Invalid merchant category" }, { status: 400 })
    }
    const amt = Number(amount)
    if (Number.isNaN(amt) || amt <= 0) {
      return Response.json({ error: "Invalid amount" }, { status: 400 })
    }
    const lat = latitude != null ? Number(latitude) : null
    const lon = longitude != null ? Number(longitude) : null

    // 1. Score pre-commit via the SPCS inference service (card-keyed lookup + XGBoost)
    let score: number | null = null
    let scoringError: string | null = null
    try {
      const r = await scoreFraud(card_number, merchant_category, amt, lat, lon)
      score = r.score
    } catch (e) {
      // Don't fail the whole transaction if scoring is unavailable; record and continue.
      scoringError = e instanceof Error ? e.message : "fraud scoring failed"
      console.error(new Date().toISOString(), "[transactions] scoring error", scoringError)
    }

    // 2. Turn the score into a verdict
    const flagged = score != null && score >= FRAUD_PROBABILITY_THRESHOLD
    const result: ScoreResult = {
      fraud_flag: flagged,
      fraud_reason: flagged ? `ML fraud score ${score!.toFixed(3)}` : null,
      anomaly_score: score,
    }

    // 3. Persist the transaction with its fraud verdict
    await queryPostgres(
      `INSERT INTO transactions
        (card_type, transaction_type, cardholder_name, card_number, expiry, cvc,
         billing_location, merchant_category, amount, latitude, longitude,
         fraud_flag, fraud_reason, anomaly_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        card_type, transaction_type, cardholder_name, card_number, expiry, cvc,
        billing_location, merchant_category, amt, lat, lon,
        result.fraud_flag, result.fraud_reason, result.anomaly_score,
      ]
    )

    return Response.json(
      { success: true, ...result, scoring_error: scoringError },
      { status: 201 }
    )
  } catch (e) {
    console.error(new Date().toISOString(), "[transactions]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to save transaction" },
      { status: 500 }
    )
  }
}
