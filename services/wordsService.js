import { pool } from '../db/connection.js'
import { translateContents } from '../services/aiService.js'
import { categorizeWordPairs } from '../services/aiService.js'
import { getAllExistingReferences } from '../utils/getAllWordReferences.js'

//words
export async function getWordBank(req, res) {
  //Return all words
  try {
    const [result] = await pool.query('SELECT * FROM wordbank;')
    res.status(200).json(result)
  }
  catch (err) {
    console.error(err)

    res.status(500).json({
      error: 'Database error'
    })
  }
}

export async function getExistingReferences(word, language) {
  try {
    const field = (language === 'es') ? 'spanish' : 'english'
    const [references] = await pool.query(
      'SELECT ? FROM wordbank WHERE ? LIKE ?',
      [field, field, `%${word}%`]
    )

    return {
      success: true,
      exists: references.length > 0,
      references
    }
  }
  catch (err) {
    console.error(err)

    return {
      success: false,
      exists: false,
      references: null
    }
  }
}

//admin/translate
export async function translate(req, res) {
  const { contents, langFrom } = req.body

  try {
    const response = await translateContents(contents, langFrom)

    if (!response.success) {
      const message = response.message
      return res.status(response.status).json({ message })
    }
  
    const translation = response.translation
    res.json({ translation })
  }
  catch (err) {
    console.error(err)

    res.status(500).json({
      message: 'Unexpected error encountered; Translation failed'
    })
  }
}

//admin/stage
export async function stageWords(req, res) {

  async function attachAllExistingReferences(data) {
    try {
      const enrichedData = await Promise.all(
        data.map(async record => {
          const allSpanish = record.spanish.split(' / ')
          const allEnglish = record.english.split(' / ')
          const [spanish, english] = await Promise.all(
            getAllExistingReferences(allSpanish, 'es'),
            getAllExistingReferences(allEnglish, 'en')
          )
          return { record, existing: { spanish, english } }
        })
      )
  
      return {
        success: true,
        rows: enrichedData
      }
    }
    catch (err) {
      console.error(err)
  
      return {
        success: false,
        status: 500,
        message: 'Internal server error'
      }
    }
  }

  const { wordPairs } = req.body
  
  try {
    let data = wordPairs
    for (const processingFunction of [categorizeWordPairs, attachAllExistingReferences]) {
      //Call categorizeWordPairs() and then attachAllExistingReferences() on its successful result
      const response = await processingFunction(data)

      if (!response.success) {
        const message = response.message
        return res.status(response.status).json({ message })
      }

      //Read contents of response
      data = response.rows 
    }

    //Return enriched data
    res.json({ rows: data })
  }
  catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unexpected error encountered; Word staging failed'
    })
  }
}

//admin/commit
export async function commitWords(req, res) {
  const { data } = req.body
  const fields = Object.keys(data[0])
  const placeholders = data
    .map(() =>
      '(' + fields.map(field => '?').join(',') + ')'
    )
    .join(',')
  
  const sql = `INSERT INTO wordbank (${fields.join(',')}) VALUES ${placeholders};`

  try {
    pool.query(sql, data.flatMap(row => Object.values(row)))

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Database error" })
  }

  return res.json({ message: `${data.length} words added successfully` })
}