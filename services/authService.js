import 'dotenv/config' //Load the environment variables
import crypto from 'crypto'
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

function getAuthCookieName() {
  return process.env.ENVIRONMENT === 'prod'
    ? '__Host-auth'
    : 'auth'
}

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

async function validateRegistration(username, email, password) {
  // Define constants
  const USERNAME_LEN_REQ = { min: 3, max: 32 }
  const PASSWORD_LEN_REQ = { min: 6, max: 32 }
  const EMAIL_LEN_MAX = 255

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

  // 7. Is password 6–32 characters?
  if (!isStringLengthBetween(PASSWORD_LEN_REQ.min, PASSWORD_LEN_REQ.max, password)) {
    result.message = `Your password must be between ${PASSWORD_LEN_REQ.min} and ${PASSWORD_LEN_REQ.max} characters long`
    return result
  }

  // 8. Does the password have at least one letter?
  if (!/[a-zA-Z]/.test(password)) {
    return { ...result, message: 'Your password must contain at least one letter' }
  }

  // Database checks:
  // 9. Is username unique? Is email unique?
  const [usernameResult, emailResult] = await Promise.all([
    pool.query(`SELECT COUNT(1) AS \`exists\` FROM users WHERE username = ?`, [username]),
    pool.query(`SELECT COUNT(1) AS \`exists\` FROM users WHERE email = ?`, [email])
  ])
  const [usernameExists] = usernameResult
  if (usernameExists[0].exists > 0) {
    result.message = `The username "${username}" is already in use`
    return result
  }
  const [emailExists] = emailResult
  if (emailExists[0].exists > 0) {
    result.message = `The email address "${email}" is already in use`
    return result
  }

  result.success = true
  return result
}


      // const validCharacters = [...new Set(password_regex_pattern)]
      // const invalidCharacters = [...password].filter(char => !validCharacters.includes(char))
      // result.message =
      //   `Your password contains the following invalid characters:
      //   ${invalidCharacters
      //     .forEach((invalidChar, i) => {
      //       return `'${invalidChar}'${i < invalidCharacters.length - 1 ? ', ' : ''}` )}`
      //     }