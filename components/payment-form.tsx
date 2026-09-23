"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { CheckCircle2, ShieldAlert, ShoppingCart, Store, Landmark } from "lucide-react"
import {
  CITIES,
  CITY_COORDS,
  MERCHANT_CATEGORIES,
  CATEGORY_AMOUNT_RANGES,
  PRESET_CARDS,
  type CardType,
  type TxType,
  type MerchantCategory,
} from "@/lib/constants"

function randomAmount(category: MerchantCategory): string {
  const { min, max } = CATEGORY_AMOUNT_RANGES[category]
  const val = min + Math.random() * (max - min)
  return val.toFixed(2)
}

function generateCardNumber(type: CardType | null) {
  if (type === "amex") {
    // Amex: 15 digits, starts with 34 or 37, grouped 4-6-5
    const prefix = Math.random() < 0.5 ? "34" : "37"
    const rest = Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join("")
    const digits = prefix + rest
    return `${digits.slice(0, 4)} ${digits.slice(4, 10)} ${digits.slice(10, 15)}`
  }
  // Visa starts with 4, Mastercard with 5; 16 digits grouped 4-4-4-4
  const first = type === "mastercard" ? "5" : "4"
  const rest = Array.from({ length: 15 }, () => Math.floor(Math.random() * 10)).join("")
  return (first + rest).match(/.{4}/g)!.join(" ")
}

function generateExpiry() {
  const mm = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0")
  const yy = String(
    (new Date().getFullYear() + Math.floor(Math.random() * 4) + 1) % 100
  ).padStart(2, "0")
  return `${mm}/${yy}`
}

function generateCVC(type: CardType | null) {
  // Amex uses a 4-digit CID
  if (type === "amex") return String(Math.floor(Math.random() * 9000) + 1000)
  return String(Math.floor(Math.random() * 900) + 100)
}

interface FraudResult {
  fraud_flag: boolean
  fraud_reason: string | null
  anomaly_score: number | null
}

export function PaymentForm() {
  const [cardType, setCardType] = useState<CardType | null>(null)
  const [txType, setTxType] = useState<TxType | null>(null)
  const [name, setName] = useState("")
  const [cardNumber, setCardNumber] = useState(() => generateCardNumber(null))
  const [expiry, setExpiry] = useState(() => generateExpiry())
  const [cvc, setCvc] = useState(() => generateCVC(null))
  const [category, setCategory] = useState<MerchantCategory>(MERCHANT_CATEGORIES[0])
  const [amount, setAmount] = useState(() => randomAmount(MERCHANT_CATEGORIES[0]))
  const [city, setCity] = useState(CITIES[0])
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<FraudResult | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function selectCard(type: CardType) {
    setCardType(type)
    setCardNumber(generateCardNumber(type))
    setCvc(generateCVC(type))
    setErrors((e) => ({ ...e, cardType: "" }))
  }

  function selectPreset(id: string) {
    const preset = PRESET_CARDS.find((p) => p.id === id)
    if (!preset) return
    setCardType(preset.cardType)
    setCardNumber(preset.cardNumber)
    setExpiry(preset.expiry)
    setCvc(preset.cvc)
    setName(preset.cardholderName)
    setErrors((e) => ({ ...e, cardType: "", name: "" }))
  }

  function selectCategory(cat: MerchantCategory) {
    setCategory(cat)
    setAmount(randomAmount(cat))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const newErrors: Record<string, string> = {}
    if (!cardType) newErrors.cardType = "Please select a card type"
    if (!txType) newErrors.txType = "Please select a transaction type"
    if (!name.trim()) newErrors.name = "Name is required"
    const amt = Number(amount)
    if (!amount || Number.isNaN(amt) || amt <= 0) newErrors.amount = "Enter a valid amount"
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)
    const coords = CITY_COORDS[city]
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          card_type: cardType,
          transaction_type: txType,
          cardholder_name: name,
          card_number: cardNumber.replace(/\s/g, ""),
          expiry,
          cvc,
          billing_location: city,
          merchant_category: category,
          amount: amt,
          latitude: coords?.lat ?? null,
          longitude: coords?.lon ?? null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrors({ submit: data.error || "Failed to save transaction" })
        return
      }
      setResult({
        fraud_flag: Boolean(data.fraud_flag),
        fraud_reason: data.fraud_reason ?? null,
        anomaly_score: typeof data.anomaly_score === "number" ? data.anomaly_score : null,
      })
      setSubmitted(true)
    } catch {
      setErrors({ submit: "Network error — could not reach server" })
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    setSubmitted(false)
    setResult(null)
    setCardType(null)
    setTxType(null)
    setName("")
    setCardNumber(generateCardNumber(null))
    setExpiry(generateExpiry())
    setCvc(generateCVC(null))
    setCategory(MERCHANT_CATEGORIES[0])
    setAmount(randomAmount(MERCHANT_CATEGORIES[0]))
    setCity(CITIES[0])
    setErrors({})
  }

  if (submitted) {
    const masked = "•••• " + cardNumber.replace(/\s/g, "").slice(-4)
    const flagged = result?.fraud_flag
    const scoreText =
      result?.anomaly_score != null ? result.anomaly_score.toFixed(2) : "—"
    return (
      <Card className="w-full max-w-md p-8 text-center">
        {flagged ? (
          <ShieldAlert className="w-14 h-14 text-red-500 mx-auto mb-4" />
        ) : (
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
        )}
        <h2 className="text-2xl font-semibold mb-2">
          {flagged ? "Transaction Flagged" : "Payment Approved"}
        </h2>
        <p className="text-muted-foreground text-sm mb-6">
          {flagged
            ? "This transaction was flagged as potentially fraudulent."
            : "Your transaction passed fraud checks and was processed."}
        </p>

        <div
          className={`rounded-lg p-4 mb-4 text-sm text-left ${
            flagged
              ? "bg-red-500/10 border border-red-500/30"
              : "bg-green-500/10 border border-green-500/30"
          }`}
        >
          <div className="flex justify-between mb-1">
            <span className="text-muted-foreground">Fraud verdict</span>
            <span className={`font-semibold ${flagged ? "text-red-500" : "text-green-600"}`}>
              {flagged ? "SUSPECTED FRAUD" : "LEGITIMATE"}
            </span>
          </div>
          {flagged && result?.fraud_reason && (
            <div className="flex justify-between mb-1">
              <span className="text-muted-foreground">Reason</span>
              <span className="font-medium">{result.fraud_reason}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Anomaly score</span>
            <span className="font-medium font-mono">{scoreText}</span>
          </div>
        </div>

        <div className="bg-muted rounded-lg p-4 text-sm text-left space-y-3">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Card type</span>
            <span className="font-medium uppercase">{cardType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Card number</span>
            <span className="font-medium font-mono">{masked}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">EUR {Number(amount).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Merchant</span>
            <span className="font-medium">{category}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location</span>
            <span className="font-medium">{city}</span>
          </div>
          {txType && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Channel</span>
              <span className="font-medium capitalize">
                {txType === "ecommerce" ? "E-commerce" : txType === "pos" ? "Point of Sale" : "ATM"}
              </span>
            </div>
          )}
        </div>
        <Button className="mt-6 w-full" variant="outline" onClick={handleReset}>
          New Transaction
        </Button>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md p-8">
      <h1 className="text-2xl font-semibold mb-1">Payment Details</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Select your card and complete the form
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Simulation card presets — reuse a fixed card across cities to trigger velocity checks */}
        <div>
          <label htmlFor="preset" className="text-sm font-medium block mb-1.5">
            Simulation Card
          </label>
          <select
            id="preset"
            defaultValue=""
            onChange={(e) => selectPreset(e.target.value)}
            className="form-input"
          >
            <option value="" disabled>
              Pick a test card (reuse across cities)…
            </option>
            {PRESET_CARDS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.cardNumber}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs mt-1">
            Select the same card, then submit from different cities in quick succession to trigger
            impossible-travel detection.
          </p>
        </div>

        {/* Card type selector */}
        <div>
          <label className="text-sm font-medium block mb-2">Card Type</label>
          <div className="grid grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => selectCard("visa")}
              className={`card-brand-btn !p-0${cardType === "visa" ? " card-brand-btn--selected" : ""}`}
            >
              <img
                src="/visa-logo.png"
                alt="Visa"
                className="absolute inset-0 w-full h-full object-cover rounded-[8px]"
              />
            </button>
            <button
              type="button"
              onClick={() => selectCard("mastercard")}
              className={`card-brand-btn !p-0${cardType === "mastercard" ? " card-brand-btn--selected" : ""}`}
            >
              <img
                src="/master-card.png"
                alt="Mastercard"
                className="absolute inset-0 w-full h-full object-cover rounded-[8px]"
              />
            </button>
            <button
              type="button"
              onClick={() => selectCard("amex")}
              className={`card-brand-btn !p-0${cardType === "amex" ? " card-brand-btn--selected" : ""}`}
            >
              <img
                src="/amex-logo.svg"
                alt="American Express"
                className="absolute inset-0 w-full h-full object-cover rounded-[8px]"
              />
            </button>
          </div>
          {errors.cardType && (
            <p className="text-destructive text-xs mt-1">{errors.cardType}</p>
          )}
        </div>

        {/* Transaction type selector */}
        <div>
          <label className="text-sm font-medium block mb-2">Transaction Type</label>
          <div className="grid grid-cols-3 gap-3">
            {([
              { id: "ecommerce", label: "E-commerce", Icon: ShoppingCart },
              { id: "pos",       label: "Point of Sale", Icon: Store },
              { id: "atm",       label: "ATM",          Icon: Landmark },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTxType(id)
                  setErrors((e) => ({ ...e, txType: "" }))
                }}
                className={`tx-type-btn${txType === id ? " tx-type-btn--selected" : ""}`}
              >
                <Icon className="w-5 h-5 mb-1.5" />
                <span className="text-xs font-medium leading-tight text-center">{label}</span>
              </button>
            ))}
          </div>
          {errors.txType && (
            <p className="text-destructive text-xs mt-1">{errors.txType}</p>
          )}
        </div>

        {/* Cardholder name */}
        <div>
          <label htmlFor="name" className="text-sm font-medium block mb-1.5">
            Cardholder Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setErrors((er) => ({ ...er, name: "" }))
            }}
            placeholder="Full name on card"
            className="form-input"
          />
          {errors.name && (
            <p className="text-destructive text-xs mt-1">{errors.name}</p>
          )}
        </div>

        {/* Merchant category + amount */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="category" className="text-sm font-medium block mb-1.5">
              Merchant Category
            </label>
            <select
              id="category"
              value={category}
              onChange={(e) => selectCategory(e.target.value as MerchantCategory)}
              className="form-input"
            >
              {MERCHANT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="amount" className="text-sm font-medium block mb-1.5">
              Amount (EUR)
            </label>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setErrors((er) => ({ ...er, amount: "" }))
              }}
              className="form-input font-mono"
            />
            {errors.amount && (
              <p className="text-destructive text-xs mt-1">{errors.amount}</p>
            )}
          </div>
        </div>

        {/* Card number */}
        <div>
          <label
            htmlFor="card-number"
            className="text-sm font-medium block mb-1.5"
          >
            Card Number
          </label>
          <input
            id="card-number"
            type="text"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            className="form-input font-mono tracking-widest"
            maxLength={19}
          />
        </div>

        {/* Expiry + CVC */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="expiry"
              className="text-sm font-medium block mb-1.5"
            >
              Expiry
            </label>
            <input
              id="expiry"
              type="text"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              placeholder="MM/YY"
              className="form-input font-mono"
              maxLength={5}
            />
          </div>
          <div>
            <label htmlFor="cvc" className="text-sm font-medium block mb-1.5">
              CVC
            </label>
            <input
              id="cvc"
              type="text"
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              placeholder="CVC"
              className="form-input font-mono"
              maxLength={4}
            />
          </div>
        </div>

        {/* Billing location */}
        <div>
          <label htmlFor="city" className="text-sm font-medium block mb-1.5">
            Billing Location
          </label>
          <select
            id="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="form-input"
          >
            {CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {errors.submit && (
          <p className="text-destructive text-sm text-center">{errors.submit}</p>
        )}

        <Button type="submit" className="w-full mt-2" disabled={submitting}>
          {submitting ? "Scoring transaction..." : "Submit Payment"}
        </Button>
      </form>
    </Card>
  )
}
