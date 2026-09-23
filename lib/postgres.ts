import { Pool } from "pg"

const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT || 5432),
  database: process.env.PG_DATABASE || "postgres",
  user: process.env.PG_USER || "snowflake_admin",
  password: process.env.PG_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
})

export async function queryPostgres<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}
