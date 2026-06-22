import 'dotenv/config' //Load the environment variables
import crypto from 'crypto'
import { pool } from '../db/connection.js'

const MS_IN_DAY = 86400000

export async function authenticateAdmin(req, res) {
  const { username, password } = req.body

  if (
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASS)
  {
    return res.status(401).json({ message: 'Invalid credentials' })
  }

  const sessionID = crypto.randomBytes(32).toString('hex')
  const expiration = new Date(Date.now() + MS_IN_DAY)

  try {
    await pool.query('UPDATE admin_session SET session_id = ?, expires = ? WHERE id = ?', [sessionID, expiration, 1])
  } catch (err) {
    console.error(err)
    return res
      .status(500)
      .json({ message: 'Database error' })
  }

  res
    .status(200)
    .cookie('auth', sessionID, { httpOnly: true, sameSite: 'strict', maxAge: MS_IN_DAY })
    .json({ message: 'Login successful' })
}

export async function isAdminAuthenticated(req, res) {
  const cookie = req.cookies?.auth

  if (!cookie) {
    return res
      .status(401)
      .json({ authenticated: false })
  }

  let result
  try {
    const [rows] = await pool.query('SELECT session_id, expires FROM admin_session WHERE id = ?', [1])
    result = rows[0]
  }
  catch (err) {
    console.error(err)
    return res
      .status(500)
      .json({ authenticated: false, message: 'Database error' })
  }

  if (!result || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(result.session_id))) {
    return res
      .status(401)
      .json({ authenticated: false, message: 'Unauthenticated' })
  }

  if (Date.now() > new Date(result.expires)) {
    await pool.query('UPDATE admin_session SET session_id = ?, expires = ? WHERE id = ?', [null, null, 1])

    return res
      .status(401)
      .json({ authenticated: false, message: 'Unauthenticated' })
  }

  res.json({ authenticated: true, message: 'Authentication successful' })
}