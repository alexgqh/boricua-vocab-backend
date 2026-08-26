import { pool } from '../db/connection.js'
import { translateContents } from '../services/aiService.js'
import { categorizeWordPairs } from '../services/aiService.js'
import { isArrayAndPopulated } from '../utils/common.js'

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

//words/references
export async function getExistingReferences(req, res) {
  const { wordPairs } = req.body //wordPairs: Array<{ es: string, en: string }>

  try {
    const result = await initExistingReferences(wordPairs)
    if (!result.success) {
      return res.status(500).json({ message: result.message })
    }
    res.json({ existingReferences: result.existingReferences }) //existingReferences: Array<{ initialized: true, spanish, english, shared }>
  }
  catch (err) {
    return res.status(500).json({ message: err })
  }
}

//wordPairs: Array<{ id, es, en }>
async function initExistingReferences(wordPairs) {
  if (!isArrayAndPopulated(wordPairs)) {
    return {
      success: false,
      status: 500,
      message: 'No data provided to check for existing references'
    }
  }

  try {
    const content = {
      spanish: wordPairs.map(wordPair => wordPair.es.split(' / ')), //Array<Array<string>>
      english: wordPairs.map(wordPair => wordPair.en.split(' / '))
    }

    //We want one query for each outer array. The regexp pattern will match all words in the inner array
    const spanishQueries = content.spanish.map(wordArray => `
      SELECT id, spanish, english
      FROM wordbank
      WHERE spanish REGEXP ?;
    `)
    const englishQueries = content.english.map(wordArray => `
      SELECT id, spanish, english
      FROM wordbank
      WHERE english REGEXP ?;
    `)
    const patterns = {
      spanish: content.spanish.map(wordArray => `(^| )(${wordArray.join('|')})( |$)`),
      english: content.english.map(wordArray => `(^| )(${wordArray.join('|')})( |$)`),
    }

    const [
      [allSpanishReferences], //Array<Array<{ id, spanish, english }>>
      [allEnglishReferences]
    ] = await Promise.all([
      pool.query(spanishQueries.join('\n'), patterns.spanish),
      pool.query(englishQueries.join('\n'), patterns.english)
    ])

    //If the spanish and english word are both referenced by the same record, separate them into a "shared" field
    const allSpanishReferenceIDs = new Set(allSpanishReferences.flat().map(ref => ref.id))
    const allEnglishReferenceIDs = new Set(allEnglishReferences.flat().map(ref => ref.id))
    const allSharedReferenceIDs = new Set(
      [...allSpanishReferenceIDs].filter(id => allEnglishReferenceIDs.has(id))
    )
    const existingReferences = {
      initialized: true,
      spanish: allSpanishReferences.filter(record => !allSharedReferenceIDs.has(record.id)),
      english: allEnglishReferences.filter(record => !allSharedReferenceIDs.has(record.id)),
      shared: allSpanishReferences.filter(record => allSharedReferenceIDs.has(record.id)),
    }

    return {
      success: true,
      existingReferences
    }
  }
  catch (err) {
    return {
      success: false,
      message: err
    }
  }
}

//words/stage

export async function stageWords(req, res) {
  const { wordPairs } = req.body // Array<{ id: string, es: string, en: string }>

  try {
    //wordRowsResult: { success: false, message: string } | { success: true, rows: Array<{ spanish: string, english: string, literal: ... }> }
    const wordRowsResult = await categorizeWordPairs(wordPairs)
    if (!wordRowsResult.success) {
      return res.status(500).json({ message: wordRowsResult.message })
    }

    //Add existing references to word rows
    const enrichedWordRows = await Promise.all(wordRowsResult.rows.map(async (row) => {
      const existingReferencesResult = await initExistingReferences([{ es: row.spanish, en: row.english }])
      const existingReferences =
        existingReferencesResult.success ?
        existingReferencesResult.existingReferences :
        { initialized: false, message: existingReferencesResult.message }
      return {
        record: row,
        existingReferences
      }
    }))

    //Return enriched data
    res.json({ rows: enrichedWordRows })
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
  const { wordRows } = req.body
  const fields = Object.keys(wordRows[0])
  const placeholders = wordRows
    .map(() =>
      '(' + fields.map(field => '?').join(',') + ')'
    )
    .join(',')

  const sql = `INSERT INTO wordbank (${fields.join(',')}) VALUES ${placeholders};`

  try {
    pool.query(sql, wordRows.flatMap(row => Object.values(row)))
  }
  catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Database error' })
  }

  return res.json({ message: `${wordRows.length} word row(s) added successfully` })
}