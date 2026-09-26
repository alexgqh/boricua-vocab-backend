import 'dotenv/config' //Load the environment variables
import crypto from 'crypto'
import argon2 from 'argon2'
import { pool } from '../db/connection.js'
import { 
  MS_IN_DAY,
  isStringAndNotWhitespace, 
  isStringLengthBetween,
  normalizeForProfanityCheck,
  EMAIL_REGEX,
} from '../utils/common.js'

import {
  DataSet,
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern
} from 'obscenity'

import { BORICUA_BANNED_USERNAME_TERMS } from '../data/bannedUsernameWords.js'

// Define constants
const USERNAME_LEN_REQ = { min: 3, max: 32 }
const PASSWORD_LEN_REQ = { min: 8, max: 256 }
const EMAIL_LEN_MAX = 255

// Start with Obscenity's built-in English profanity dataset.
const profanityDataset = new DataSet()
  .addAll(englishDataset)

// Add our Puerto Rican Spanish profanity to the same dataset.
BORICUA_BANNED_USERNAME_TERMS.forEach(term => {
  profanityDataset.addPhrase(phrase =>
    phrase
      .setMetadata({ originalWord: term })
      .addPattern(parseRawPattern(term))
  )
})

//Helper functions to return cookie names
function getAdminAuthCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-auth'
    : 'auth'
}
function getUserSessionCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-session'
    : 'session'
}

// Build one matcher containing both English and Boricua profanity.
const profanityMatcher = new RegExpMatcher({
  ...profanityDataset.build(),
  ...englishRecommendedTransformers
})

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
    .cookie(getAdminAuthCookieName(), sessionID, {
      httpOnly: true,
      secure: process.env.ENVIRONMENT === 'prod',
      sameSite: 'strict',
      path: '/',
      maxAge: MS_IN_DAY
    })
    .json({ message: 'Login successful' })
}

export async function isAdminAuthenticated(req, res) {
  const cookie = req.cookies?.[getAdminAuthCookieName()]

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
  const cookieToken = req.cookies?.[getAdminAuthCookieName()]
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

export async function registerUser(req, res) {
  try {
    // 1. Read request body
    const { username, email, password } = req.body ?? {}
  
    // 2. Validate that supplied credentials are valid for their respective fields
    const validationResults = await validateRegistration(username, email, password)
  
    if (!validationResults.success) {
      return res.status(validationResults.status ?? 400).json({
        message: validationResults.message
      })
    }
  
    // 3. Hash password
    const password_hash = await hashPassword(password)
  
    // 4. Create user
    const normalizedUsername = validationResults.username
    const normalizedEmail = validationResults.email
    const creationResults = await createUser(
      normalizedUsername,
      normalizedEmail,
      password_hash
    )
  
    // 5. Make sure user was created
    if (!creationResults.success) {
      return res.status(creationResults.status ?? 500).json({
        message: creationResults.message
      })
    }

    // 6. Create user session
    const sessionResults = await createUserSession(creationResults.userId)

    // 7. Make sure session was created
    if (!sessionResults.success) {
      return res.status(201).json({
        message: 'Account created successfully, but you could not be signed in automatically. Please log in.'
      })
    }
  
    // 8. Registration completed and session created successfully
    return res
      .status(201)
      .cookie(
        getUserSessionCookieName(),
        sessionResults.token,
        {
          httpOnly: true,
          secure: process.env.ENVIRONMENT === 'prod',
          sameSite: 'strict',
          path: '/'
        }
      )
      .json({
        message: `Bienvenidos, ${validationResults.username}!`
      })
  }
  catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Internal server error'
    })
  }
}

async function hashPassword(password) {
  const password_hash = await argon2.hash(password, {
    type: argon2.argon2id
  })
  return password_hash
}

async function validateRegistration(username, email, password) {
  // Initialize return object
  const result = {
    success: false,
    message: null
  }

  // 1. Are all required fields present?
  if (!isStringAndNotWhitespace(username)) return { ...result, message: "No username provided" }
  if (!isStringAndNotWhitespace(email)) return { ...result, message: "No email provided" }
  if (!isStringAndNotWhitespace(password)) return { ...result, message: "No password provided" }

  // Trim username and email
  username = username.trim()
  email = email.trim()

  // 2. Is username 3–32 characters?
  if (!isStringLengthBetween(USERNAME_LEN_REQ.min, USERNAME_LEN_REQ.max, username)) {
    result.message = `Your username must be between ${USERNAME_LEN_REQ.min} and ${USERNAME_LEN_REQ.max} characters long`
    return result
  }

  // 3. Does username contain only A-Z, a-z, 0-9, _, -, and .?
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    result.message = "Username may only include alphanumeric characters, periods (.), underscores (_), or hyphens (-)"
    return result
  }

  // 4. Does username pass the profanity filter?
  if (profanityMatcher.hasMatch(normalizeForProfanityCheck(username))) {
    result.message = 'Username contains inappropriate language'
    return result
  }

  // 5. Is email <= 255 characters?
  if (email.length > EMAIL_LEN_MAX) {
    result.message = `Your email address may not be longer than ${EMAIL_LEN_MAX} characters long`
    return result
  }

  // 6. Is email reasonably formatted?
  if (!EMAIL_REGEX.test(email)) {
    result.message = "Invalid email address provided"
    return result
  }

  // 7. Is password 8–256 characters?
  if (!isStringLengthBetween(PASSWORD_LEN_REQ.min, PASSWORD_LEN_REQ.max, password)) {
    result.message = `Your password must be between ${PASSWORD_LEN_REQ.min} and ${PASSWORD_LEN_REQ.max} characters long`
    return result
  }

  // 8. Does the password have at least one letter?
  if (!/\p{L}/u.test(password)) {
    return { ...result, message: 'Your password must contain at least one letter' }
  }

  // Database checks:
  // 9. Is username unique? Is email unique?
  {
    const [rows] = await pool.query(
      `
        SELECT
          EXISTS(
            SELECT 1
            FROM users
            WHERE username = ?
          ) AS username_exists,
    
          EXISTS(
            SELECT 1
            FROM users
            WHERE email = ?
          ) AS email_exists
      `,
      [username, email]
    )
    
    const { username_exists, email_exists } = rows[0]
    
    if (username_exists) {
      result.message = `The username "${username}" is already in use`
      result.status = 409
      return result
    }
    
    if (email_exists) {
      result.message = `The email address "${email}" is already in use`
      result.status = 409
      return result
    }
  }

  result.success = true
  result.username = username
  result.email = email
  return result
}

async function createUser(username, email, password_hash) {
  const result = {
    success: false,
    message: 'Failed to add user'
  }

  try {
    // 1. Run query to create user
    const [queryResult] = await pool.query(`
      INSERT INTO users
        (username, email, password_hash)
      VALUES (?, ?, ?);`,
      [username, email, password_hash]
    )
  
    // 2. Verify that the user was added
    if (queryResult.affectedRows !== 1) {
      return result
    }
  
    // 3. Return success status and user id
    return {
      success: true,
      userId: queryResult.insertId
    }
  }
  catch (err) {
    // Query failed to run
    console.error(err.message)

    if (err.code === 'ER_DUP_ENTRY') {
      result.message = 'That username or email address is already in use'
      result.status = 409
      return result
    }

    return result
  }
}

async function createUserSession(userId) {
  const result = {
    success: false,
    message: 'Failed to create session'
  }

  // Generate 32 cryptographically random bytes and turn them
  // into a browser-friendly string.
  const token = crypto.randomBytes(32).toString('base64url')

  // Store only a SHA-256 hash of the token in the database.
  // .digest() with no encoding returns a 32-byte Buffer,
  // which fits sessions.token_hash BINARY(32).
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest()

  const expiresAt = new Date(Date.now() + MS_IN_DAY)

  try {
    const [queryResult] = await pool.query(
      `
        INSERT INTO sessions
          (user_id, token_hash, expires_at)
        VALUES (?, ?, ?)
      `,
      [userId, tokenHash, expiresAt]
    )

    if (queryResult.affectedRows !== 1) {
      return result
    }

    return {
      success: true,
      token,
      expiresAt
    }
  }
  catch (err) {
    console.error(err.message)
    return result
  }
}

// const result = await validateRegistration('alex', 'asdf@gmail.com', 'asdffj')
// console.log(result)