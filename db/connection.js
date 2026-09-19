import { createPool } from "mysql2"

// Load the environment variables
import 'dotenv/config'

const pool = createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  multipleStatements: true //Allows you to send multiple semicolon-separated queries at once
}).promise()

export { pool }