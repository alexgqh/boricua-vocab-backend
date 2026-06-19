import { pool } from '../db/connection.js'

async function doesWordExist(word, lang) {
  try {
    const field = (lang === 'sp') ? 'spanish' : 'english'
    const [similar] = await pool.query(
      'SELECT ? FROM dictionary WHERE ? LIKE ?',
      [field, field, `%${word}%`]
    )

    return {
      success: true,
      exists: similar.length > 0,
      similar
    }
  }
  catch (err) {
    console.error(err)

    return {
      success: false,
      exists: false,
      similar: null
    }
  }
}

export { doesWordExist }