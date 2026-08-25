import { createPool } from "mysql2"

// 1. Load the environment variables first!
import 'dotenv/config'

const pool = createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  multipleStatements: true //Allows you to send multiple semicolon-separated commands at once
}).promise()

export { pool }