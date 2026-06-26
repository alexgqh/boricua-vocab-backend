import { pool } from '../db/connection.js'
import { translateContents } from '../services/aiService.js'
import { categorizeWordPairs } from '../services/aiService.js'
import { getAllExistingReferences } from '../utils/getAllExistingReferences.js'

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
      `SELECT id, spanish, english FROM wordbank WHERE CONCAT(' ', ${field}, ' ') LIKE ?`,
      [`% ${word} %`]
    )

    return {
      success: true,
      exists: references.length > 0,
      references //array of { id, spanish, english }
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

//words/translate
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

async function attachAllExistingReferences(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      status: 500,
      message: 'No data provided upon which to attach existing references'
    }
  }
  try {
    const enrichedData = await Promise.all(data.map(async record => {
      const allSpanishContent = record.spanish.split(' / ')
      const allEnglishContent = record.english.split(' / ')
      const [allSpanishReferences, allEnglishReferences] = await Promise.all([
        getAllExistingReferences(allSpanishContent, 'es'), //array of array of { spanish, english }
        getAllExistingReferences(allEnglishContent, 'en')  //array of array of { spanish, english }
      ])

      //If the spanish and english word are both referenced by the same record, separate them into a "shared" key
      const allSpanishReferenceIDs = new Set(allSpanishReferences.flat().map(ref => ref.id))
      const allEnglishReferenceIDs = new Set(allEnglishReferences.flat().map(ref => ref.id))
      const allSharedReferenceIDs = new Set(
        [...allSpanishReferenceIDs].filter(id => allEnglishReferenceIDs.has(id))
      )
      const existingReferences = {
        spanish: allSpanishReferences.filter(record => !allSharedReferenceIDs.has(record.id)),
        english: allEnglishReferences.filter(record => !allSharedReferenceIDs.has(record.id)),
        shared: allSpanishReferences.filter(record => allSharedReferenceIDs.has(record.id)),
      }
      return { record, existingReferences }
    }))

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

//words/stage
export async function stageWords(req, res) {
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

//words/commit
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
  }
  catch (err) {
    console.error(err)
    return res.status(500).json({ message: "Database error" })
  }

  return res.json({ message: `${data.length} words added successfully` })
}