// Seed 200 realistic "normal" transactions into Postgres to train the anomaly model.
// Run with:  node --env-file=.env.local scripts/seed-transactions.mjs
import pg from "pg"

const CITY_COORDS = {
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
const CITIES = Object.keys(CITY_COORDS)

// category -> amount range + the channels that make sense for it
const CATEGORIES = {
  Groceries: { min: 15, max: 120, channels: ["pos", "ecommerce"] },
  Electronics: { min: 50, max: 800, channels: ["ecommerce", "pos"] },
  Travel: { min: 100, max: 1200, channels: ["ecommerce"] },
  Restaurants: { min: 20, max: 150, channels: ["pos"] },
  Fuel: { min: 40, max: 100, channels: ["pos"] },
  Entertainment: { min: 10, max: 90, channels: ["ecommerce", "pos"] },
  Jewelry: { min: 200, max: 2000, channels: ["ecommerce", "pos"] },
  "Cash Withdrawal": { min: 20, max: 400, channels: ["atm"] },
}
const CATEGORY_NAMES = Object.keys(CATEGORIES)

const CARD_TYPES = ["visa", "mastercard", "amex"]
const FIRST_NAMES = ["James", "Maria", "Chen", "Aisha", "Lars", "Sofia", "David", "Yuki", "Omar", "Emma", "Liam", "Nina", "Carlos", "Priya", "Tom"]
const LAST_NAMES = ["Smith", "Garcia", "Wang", "Khan", "Nielsen", "Rossi", "Brown", "Tanaka", "Haddad", "Muller", "Silva", "Patel", "Jones", "Kim", "Lopez"]

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)]
const randFloat = (min, max) => min + Math.random() * (max - min)

function genCardNumber(type) {
  if (type === "amex") {
    const prefix = Math.random() < 0.5 ? "34" : "37"
    const rest = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join("")
    return prefix + rest
  }
  const first = type === "mastercard" ? "5" : "4"
  const rest = Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")
  return first + rest
}
function genExpiry() {
  const mm = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")
  const yy = String((new Date().getFullYear() + Math.floor(Math.random() * 4) + 1) % 100).padStart(2, "0")
  return `${mm}/${yy}`
}
function genCVC(type) {
  return type === "amex"
    ? String(Math.floor(Math.random() * 9000) + 1000)
    : String(Math.floor(Math.random() * 900) + 100)
}

// Build 40 cardholders, each with a stable card + home city so normal
// transactions cluster geographically (makes impossible-travel meaningful).
const NUM_CARDS = 40
const cards = Array.from({ length: NUM_CARDS }, () => {
  const type = rand(CARD_TYPES)
  return {
    card_type: type,
    card_number: genCardNumber(type),
    expiry: genExpiry(),
    cvc: genCVC(type),
    name: `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`,
    home: rand(CITIES),
  }
})

const N = 200
const rows = []
for (let i = 0; i < N; i++) {
  const card = rand(cards)
  const category = rand(CATEGORY_NAMES)
  const cfg = CATEGORIES[category]
  const channel = rand(cfg.channels)
  const amount = Number(randFloat(cfg.min, cfg.max).toFixed(2))
  // 85% at home city, 15% elsewhere (still legitimate travel)
  const city = Math.random() < 0.85 ? card.home : rand(CITIES)
  const coords = CITY_COORDS[city]
  // spread timestamps across the last 30 days
  const daysAgo = Math.random() * 30
  const createdAt = new Date(Date.now() - daysAgo * 86400_000)
  rows.push([
    card.card_type,
    channel,
    card.name,
    card.card_number,
    card.expiry,
    card.cvc,
    city,
    category,
    amount,
    coords.lat,
    coords.lon,
    createdAt.toISOString(),
    false, // fraud_flag — seed data is the "normal" baseline
    null, // fraud_reason
    null, // anomaly_score
  ])
}

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || "postgres",
  user: process.env.PG_USER || "snowflake_admin",
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
})

const client = await pool.connect()
try {
  let inserted = 0
  for (const r of rows) {
    await client.query(
      `INSERT INTO transactions
        (card_type, transaction_type, cardholder_name, card_number, expiry, cvc,
         billing_location, merchant_category, amount, latitude, longitude,
         created_at, fraud_flag, fraud_reason, anomaly_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      r
    )
    inserted++
  }
  console.log(`Inserted ${inserted} seed transactions across ${NUM_CARDS} cards.`)
} finally {
  client.release()
  await pool.end()
}
