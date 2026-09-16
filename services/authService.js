import 'dotenv/config' //Load the environment variables
import crypto from 'crypto'
import { pool } from '../db/connection.js'
import { MS_IN_DAY } from '../utils/common.js'

function getAuthCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-auth'
    : 'auth'
}

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
    .cookie(getAuthCookieName(), sessionID, {
      httpOnly: true,
      secure: process.env.ENVIRONMENT === 'prod',
      sameSite: 'strict',
      path: '/',
      maxAge: MS_IN_DAY
    })
    .json({ message: 'Login successful' })
}

export async function isAdminAuthenticated(req, res) {
  const cookie = req.cookies?.[getAuthCookieName()]

  if (!cookie) {
    return res
      .status(401)
      .json({ authenticated: false })
  }

  let result

  try {
    const [rows] = await pool.query(
      'SELECT session_id, expires FROM admin_session WHERE id = ?',
      [1]
    )

    result = rows[0]
  }
  catch (err) {
    console.error(err)

    return res
      .status(500)
      .json({
        authenticated: false,
        message: 'Database error'
      })
  }

  if (!result?.session_id) {
    return res
      .status(401)
      .json({
        authenticated: false,
        message: 'Unauthenticated'
      })
  }

  const provided = Buffer.from(cookie)
  const expected = Buffer.from(result.session_id)

  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return res
      .status(401)
      .json({
        authenticated: false,
        message: 'Unauthenticated'
      })
  }

  if (Date.now() > new Date(result.expires).getTime()) {
    await pool.query(
      'UPDATE admin_session SET session_id = ?, expires = ? WHERE id = ?',
      [null, null, 1]
    )

    return res
      .status(401)
      .json({
        authenticated: false,
        message: 'Unauthenticated'
      })
  }

  res.json({
    authenticated: true,
    message: 'Authentication successful'
  })
}

export async function requireAdmin(req, res, next) {
  const cookieToken = req.cookies?.[getAuthCookieName()]
  const header = req.get('Authorization')

  let token = cookieToken

  if (!token && header?.startsWith('Bearer ')) {
    token = header.slice(7)
  }

  if (!token) {
    return res.status(401).json({
      message: 'Authentication required'
    })
  }

  try {
    const [rows] = await pool.query(
      'SELECT session_id, expires FROM admin_session WHERE id = ?',
      [1]
    )

    const session = rows[0]

    if (!session?.session_id || !session.expires) {
      return res.status(401).json({
        message: 'Unauthenticated'
      })
    }

    const expected = Buffer.from(session.session_id)
    const provided = Buffer.from(token)

    /*
      timingSafeEqual() throws if the Buffers have different lengths,
      so check the length before comparing.
    */
    if (
      expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)
    ) {
      return res.status(401).json({
        message: 'Unauthenticated'
      })
    }

    if (Date.now() > new Date(session.expires).getTime()) {
      await pool.query(
        'UPDATE admin_session SET session_id = ?, expires = ? WHERE id = ?',
        [null, null, 1]
      )

      return res.status(401).json({
        message: 'Session expired'
      })
    }

    next()
  }
  catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Database error'
    })
  }
}