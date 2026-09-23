/** App title — displayed in the nav header and browser tab */
export const APP_TITLE = "Credit Card Fraud Detection Demo"

/** Path to the logo in /public (used in the header and as favicon) */
export const LOGO_SRC = "/icon.svg"

/** Supported card brands */
export type CardType = "visa" | "mastercard" | "amex"

/** Transaction channels */
export type TxType = "ecommerce" | "pos" | "atm"

/** Merchant categories used as a fraud-detection feature */
export const MERCHANT_CATEGORIES = [
  "Groceries",
  "Electronics",
  "Travel",
  "Restaurants",
  "Fuel",
  "Entertainment",
  "Jewelry",
  "Cash Withdrawal",
] as const

export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number]

/**
 * Integer encoding for MERCHANT_CATEGORY sent to the fraud model.
 * MUST match the CASE mapping in the training notebook
 * (setup_realtime_fraud_feature_store.ipynb, Part IV).
 */
export const MERCHANT_CATEGORY_CODES: Record<MerchantCategory, number> = {
  "Cash Withdrawal": 0,
  Electronics: 1,
  Entertainment: 2,
  Fuel: 3,
  Groceries: 4,
  Jewelry: 5,
  Restaurants: 6,
  Travel: 7,
}

/**
 * Fixed simulation cards. Selecting one reuses a stable card number across
 * submissions, so you can fire the same card from different cities in quick
 * succession to trigger the impossible-travel (velocity) fraud rule.
 */
export interface PresetCard {
  id: string
  label: string
  cardType: CardType
  cardholderName: string
  cardNumber: string // display format, with spaces
  expiry: string
  cvc: string
}

export const PRESET_CARDS: PresetCard[] = [
  {
    id: "visa-alice",
    label: "Visa · Alice Bauer",
    cardType: "visa",
    cardholderName: "Alice Bauer",
    cardNumber: "4111 1111 1111 1111",
    expiry: "08/28",
    cvc: "123",
  },
  {
    id: "mc-bob",
    label: "Mastercard · Bob Novak",
    cardType: "mastercard",
    cardholderName: "Bob Novak",
    cardNumber: "5555 4444 3333 2222",
    expiry: "04/27",
    cvc: "456",
  },
  {
    id: "amex-carol",
    label: "Amex · Carol Meyer",
    cardType: "amex",
    cardholderName: "Carol Meyer",
    cardNumber: "3782 822463 10005",
    expiry: "11/29",
    cvc: "1234",
  },
]

/**
 * City + country options with latitude/longitude.
 * Coordinates power the impossible-travel (velocity) fraud rule.
 */
export const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  "New York, USA": { lat: 40.7128, lon: -74.006 },
  "Los Angeles, USA": { lat: 34.0522, lon: -118.2437 },
  "Chicago, USA": { lat: 41.8781, lon: -87.6298 },
  "London, UK": { lat: 51.5074, lon: -0.1278 },
  "Manchester, UK": { lat: 53.4808, lon: -2.2426 },
  "Paris, France": { lat: 48.8566, lon: 2.3522 },
  "Berlin, Germany": { lat: 52.52, lon: 13.405 },
  "Amsterdam, Netherlands": { lat: 52.3676, lon: 4.9041 },
  "Tokyo, Japan": { lat: 35.6762, lon: 139.6503 },
  "Singapore, Singapore": { lat: 1.3521, lon: 103.8198 },
  "Sydney, Australia": { lat: -33.8688, lon: 151.2093 },
  "Toronto, Canada": { lat: 43.6532, lon: -79.3832 },
  "São Paulo, Brazil": { lat: -23.5505, lon: -46.6333 },
  "Dubai, UAE": { lat: 25.2048, lon: 55.2708 },
  "Mumbai, India": { lat: 19.076, lon: 72.8777 },
}

/** City list for the billing-location dropdown (derived from CITY_COORDS). */
export const CITIES = Object.keys(CITY_COORDS)

/**
 * Realistic amount ranges (EUR) per merchant category. Used by both the seed
 * generator (to build the "normal" baseline) and the form (to pre-fill a
 * plausible random amount for the selected category).
 */
export const CATEGORY_AMOUNT_RANGES: Record<MerchantCategory, { min: number; max: number }> = {
  Groceries: { min: 15, max: 120 },
  Electronics: { min: 50, max: 800 },
  Travel: { min: 100, max: 1200 },
  Restaurants: { min: 20, max: 150 },
  Fuel: { min: 40, max: 100 },
  Entertainment: { min: 10, max: 90 },
  Jewelry: { min: 200, max: 2000 },
  "Cash Withdrawal": { min: 20, max: 400 },
}

/** Fraud thresholds shared across scoring logic. */
export const FRAUD_ANOMALY_THRESHOLD = 0.9 // anomaly_score above this = flagged
export const IMPOSSIBLE_TRAVEL_KMH = 900 // implied speed above this = impossible travel
export const IMPOSSIBLE_TRAVEL_WINDOW_SEC = 3600 // only within this window

/** Fraud probability above this (model output) = flagged. Override with FRAUD_PROBABILITY_THRESHOLD. */
export const FRAUD_PROBABILITY_THRESHOLD = 0.5

/** Haversine distance in km between two lat/lon points. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371 // earth radius km
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}
