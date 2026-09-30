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
  isFutureDate,
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
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.ENVIRONMENT === 'prod',
  sameSite: 'strict',
  path: '/'
}
const DUMMY_HASH = await hashPassword('this dummy hash will be used to prevent timing discrepancies')

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

// Build one matcher containing both English and Boricua profanity.
const profanityMatcher = new RegExpMatcher({
  ...profanityDataset.build(),
  ...englishRecommendedTransformers
})

export async function authenticateAdmin(req, res) {
  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASS) {
    console.error('Admin username and/or password are not configured')
    return res.status(500).json({
      message: 'Internal authentication error'
    })
  }

  const { username, password } = req.body ?? {}

  if (
    username !== process.env.ADMIN_USER ||
    password !== process.env.ADMIN_PASS)
  {
    return res.status(401).json({ message: 'Invalid credentials' })
  }

  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const expiration = new Date(Date.now() + MS_IN_DAY)

  try {
    const [result] = await pool.query(
      'UPDATE admin_session SET token_hash = ?, expires_at = ? WHERE id = ?',
      [tokenHash, expiration, 1]
    )

    if (result.affectedRows !== 1) {
      console.error('Unexpected number of rows affected in admin_session')
      return res
        .status(500)
        .json({ message: 'Internal authentication error'})
    }
  } catch (err) {
    console.error(err)
    return res
      .status(500)
      .json({ message: 'Internal authentication error' })
  }

  res
    .status(200)
    .cookie(getAdminSessionCookieName(), token, {
      ...COOKIE_OPTIONS,
      maxAge: MS_IN_DAY
    })
    .json({ message: 'Login successful' })
}

async function validateAdminSession(req) {
  const result = {
    authenticated: false,
    status: 401,
    message: 'Authentication required',
    clearCookie: true,
    clearSession: false
  }

  const token = req.cookies?.[getAdminSessionCookieName()]

  if (!token) {
    result.clearCookie = false
    return result
  }

  try {
    const [rows] = await pool.query(
      'SELECT token_hash, expires_at FROM admin_session WHERE id = ?',
      [1]
    )

    const session = rows[0]

    if (!session?.token_hash || !session.expires_at) {
      return result
    }

    const expectedHash = session.token_hash
    const providedHash = hashToken(token)

    /*
      timingSafeEqual() throws if the Buffers have different lengths,
      so check the length before comparing.
    */
    if (
      expectedHash.length !== providedHash.length ||
      !crypto.timingSafeEqual(expectedHash, providedHash)
    ) {
      return result
    }

    // Check if admin session is expired
    if (!isFutureDate(session.expires_at)) {
      result.clearSession = true
      result.message = 'Session expired'
      return result
    }

    return {
      authenticated: true,
      message: 'Authentication successful'
    }
  }
  catch (err) {
    console.error(err)

    result.clearCookie = false
    result.status = 500
    result.message = 'Internal authentication error'
    return result
  }
}

async function cleanupAdminSession(session, res) {
  if (session.clearCookie) {
    clearAdminSessionCookie(res)
  }
  if (session.clearSession) {
    await deleteAdminSession()
  }
}

export async function isAdminAuthenticated(req, res) {
  const session = await validateAdminSession(req)

  if (!session.authenticated) {
    await cleanupAdminSession(session, res)

    return res.status(session.status).json({
      authenticated: false,
      message: session.message
    })
  }
  return res.status(200).json({
    authenticated: true,
    message: session.message
  })
}

export async function requireAdmin(req, res, next) {
  const session = await validateAdminSession(req)
  if (!session.authenticated) {
    await cleanupAdminSession(session, res)

    return res.status(session.status).json({
      authenticated: false,
      message: session.message
    })
  }
  next()
}

export async function registerUser(req, res) {
  try {
    // Read request body
    const { username, email, password } = req.body ?? {}
  
    // Validate that supplied credentials are valid for their respective fields
    const validationResults = await validateRegistration(username, email, password)
  
    if (!validationResults.success) {
      return res.status(validationResults.status ?? 400).json({
        message: validationResults.message
      })
    }
  
    // Hash password
    const passwordHash = await hashPassword(password)
  
    // Create user
    const normalizedUsername = validationResults.username
    const normalizedEmail = validationResults.email
    const creationResults = await createUser(
      normalizedUsername,
      normalizedEmail,
      passwordHash
    )
  
    // Make sure user was created
    if (!creationResults.success) {
      return res.status(creationResults.status ?? 500).json({
        message: creationResults.message
      })
    }

    // Create session
    const sessionResults = await createSession(creationResults.userId)

    // Make sure session was created
    if (!sessionResults.success) {
      return res.status(201).json({
        message: 'Account created successfully, but you could not be signed in automatically. Please log in.'
      })
    }
  
    // Registration completed and session created successfully
    return res
      .status(201)
      .cookie(
        getSessionCookieName(),
        sessionResults.token,
        COOKIE_OPTIONS
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

async function createUser(username, email, passwordHash) {
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
      [username, email, passwordHash]
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

async function createSession(userId) {
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
  const tokenHash = hashToken(token)

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

async function validateSession(req) {
  const result = {
    authenticated: false,
    message: 'Not authorized',
    status: 401,
    clearSession: false,
    clearCookie: true
  }

  // Read cookie
  const token = req.cookies?.[getSessionCookieName()]

  // Make sure session cookie exists
  if (!token) {
    result.clearCookie = false
    return result
  }

  try {
    // Hash token
    const tokenHash = hashToken(token)

    // Read database
    const [rows] = await pool.query(`
      SELECT
        sessions.id,
        sessions.user_id,
        sessions.expires_at,
        users.username
      FROM sessions
      JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
      LIMIT 1
    `, [tokenHash])

    // Check if session exists
    const session = rows?.[0]
    if (!session) {
      return result
    }

    // Check if session is expired
    const expiration = session.expires_at
    if (!isFutureDate(expiration)) {
      
      // Pass information along so the session may be deleted
      result.clearSession = true
      result.sessionId = session.id

      // Return 401 failure
      result.message = 'Session expired'
      return result
    }

    // Session authenticated
    return {
      authenticated: true,
      username: session.username,
      userId: session.user_id
    }
  }
  catch (err) {
    console.error(err.message)
    return {
      authenticated: false,
      message: 'Internal authentication error',
      status: 500,
      clearCookie: false,
      clearSession: false,
    }
  }
}

// Is this request associated with a valid user session?
// (This function assumes that requireUser() runs before it)
export function authenticateSession(req, res) {
  return res
    .status(200)
    .json({
      authenticated: true,
      message: 'Session authenticated',
      username: req.user.username,
      userId: req.user.id
    })
}

export async function requireUser(req, res, next) {
  // Validate session
  const sessionResults = await validateSession(req)

  // Check if session is authenticated
  if (!sessionResults.authenticated) {
      
    // Clear cookie to prevent checking db needlessly in the future
    if (sessionResults.clearCookie) {
      clearSessionCookie(res)
    }

    // Delete session if expired
    if (sessionResults.clearSession) {
      await deleteSession(sessionResults.sessionId)
    }
  
    // Return failure
    return res
      .status(sessionResults.status ?? 500)
      .json({
        authenticated: false,
        message: sessionResults.message
      })
  }

  req.user = {
    id: sessionResults.userId,
    username: sessionResults.username
  }
  next()
}

async function verifyUser(username, password) {
  const result = {
    success: false,
    status: 400,
    message: null
  }

  // Check that username and password are strings
  if (typeof username !== 'string' || typeof password !== 'string') {
    result.message = 'Username or password were of invalid type'
    return result
  }

  // Save trimmed version of username
  const trimmedUsername = username.trim()

  // Check if username or password are blank
  if (trimmedUsername === '') {
    result.message = 'Username is required'
    return result
  }
  if (password.trim() === '') {
    result.message = 'Password is required'
    return result
  }

  // Check lengths
  result.status = 401
  result.message = 'Invalid username or password'
  if (!isStringLengthBetween(USERNAME_LEN_REQ.min, USERNAME_LEN_REQ.max, trimmedUsername)) {
    return result
  }
  if (!isStringLengthBetween(PASSWORD_LEN_REQ.min, PASSWORD_LEN_REQ.max, password)) {
    return result
  }

  try {
    // Get user id and hashed password from the database
    const [rows] = await pool.query(
      `
        SELECT id, password_hash
        FROM users
        WHERE username = ?  
      `,
    [trimmedUsername])
    
    // Check that user exists
    const user = rows?.[0]
    if (!user) {
      // Do a dummy argon2 comparison to limit timing-based username enumeration
      await dummyArgon2compare(password)
      return result
    }

    // Check that password is correct
    const comparison = await argon2compare(user.password_hash, password)
    if (comparison.succeeded) {
      if (!comparison.match) {
        return result
      }
    } else {
      // Password hash is possibly malformed
      result.status = 500
      result.message = 'Internal authentication error'
      return result
    }

    return {
      success: true,
      userId: user.id
    }
  }
  catch (err) {
    console.error(err.message)

    result.status = 500
    result.message = 'Internal authentication error'
    return result
  }
}

export async function loginUser(req, res) {
  const { username, password } = req.body ?? {}

  // Verify username and password are valid
  const verification = await verifyUser(username, password)
  if (!verification.success) {
    return res.status(verification.status).json({
      message: verification.message
    })
  }

  // Create user session
  const sessionResults = await createSession(verification.userId)
  if (!sessionResults.success) {
    return res.status(500).json({
      message: sessionResults.message
    })
  }

  // Send cookie to browser
  return res
    .status(200)
    .cookie(getSessionCookieName(), sessionResults.token, COOKIE_OPTIONS)
    .json({
      message: 'User session created'
    })
}

//// HELPER FUNCTIONS ////

function getAdminSessionCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-auth'
    : 'auth'
}

function getSessionCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-session'
    : 'session'
}

function hashToken(token) {
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest()
  return tokenHash
}

async function hashPassword(password) {
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id
  })
  return passwordHash
}

function clearSessionCookie(res) {
  res.clearCookie(getSessionCookieName(), COOKIE_OPTIONS)
}

function clearAdminSessionCookie(res) {
  res.clearCookie(getAdminSessionCookieName(), COOKIE_OPTIONS)
}

async function deleteSession(sessionId) {
  try {
    await pool.query(
      `
        DELETE FROM sessions
        WHERE id = ?
      `,
      [sessionId]
    )
  }
  catch (err) {
    console.error(err.message)
  }
}

async function deleteAdminSession() {
  try {
    await pool.query(
      'UPDATE admin_session SET token_hash = ?, expires_at = ? WHERE id = ?',
      [null, null, 1]
    )
  }
  catch (err) {
    console.error(err.message)
  }
}

async function argon2compare(passwordHash, password) {
  try {
    const match = await argon2.verify(passwordHash, password)
    return {
      succeeded: true,
      match
    }
  }
  catch (err) {
    console.error(err.message)

    // Run a dummy comparison to limit timing-based password enumeration
    await dummyArgon2compare(password)

    return {
      succeeded: false,
    }
  }
}

async function dummyArgon2compare(password) {
  try {
    await argon2.verify(DUMMY_HASH, password)
  }
  catch (err) {
    console.error(err)
  }
}