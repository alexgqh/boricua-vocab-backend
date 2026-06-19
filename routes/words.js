import { Router } from 'express'
import { findExistingReferences } from '../utils/findExistingReferences.js'
import { translateContents, categorizeWordPairs } from '../services/aiService.js'
import { pool } from '../db/connection.js'

const router = Router()

router.get('/', fetchAll)
router.post('/translate', translate)
router.post('/stage', stageWords)
router.post('/commit', commitWords)

async function fetchAll(req, res) {
  //Return all words
  try {
    const [result] = await pool.query('SELECT * FROM dictionary;')
    res.status(200).json(result)
  }
  catch (err) {
    console.error(err)

    res.status(500).json({
      error: 'Database error'
    })
  }
}

async function translate(req, res) {
  const { contents, langFrom } = req.body

  if (!contents || !langFrom) {
    return res.status(400).json({ message: 'The required information was not provided' })
  }

  const translation = await translateContents(contents, langFrom)

  if (!translation) {
    return res.status(500).json({ message: 'Translation error' })
  }

  res.json({ contents, translation })
}

async function stageWords(req, res) {
  const { wordPairs } = req.body

  if (!Array.isArray(wordPairs) || wordPairs.length === 0) {
    return res.status(400).json({
      message: 'No words provided'
    })
  }

  try {
    const categorizedData = await categorizeWordPairs(wordPairs)

    //Enrich data with checks to see if any of the words already exist in the db
    const enrichedData = await Promise.all(
      categorizedData.map(async record => {
        const allSpanish = record.spanish.split(' / ')
        const allEnglish = record.english.split(' / ')
        const [sp, en] = await Promise.all(
          await findExistingReferences(allSpanish, 'sp'),
          await findExistingReferences(allEnglish, 'en')
        )
        return { record, exists: { sp, en } }
      })
    )

    res.json(enrichedData)
  }
  catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Internal server error'
    })
  }
}

async function commitWords(req, res) {
  const { data } = req.body
  const fields = Object.keys(data[0])
  const placeholders = data
    .map(() =>
      '(' + fields.map(field => '?').join(',') + ')'
    )
    .join(',')
  
  const sql = `INSERT INTO dictionary (${fields.join(',')}) VALUES ${placeholders};`

  try {
    pool.query(sql, data.flatMap(row => Object.values(row)))

  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: "Database error" })
  }

  return res.json({ message: `${data.length} words added successfully` })
}

export default router