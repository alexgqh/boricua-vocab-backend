import { Router } from 'express'
import { doesWordExist } from '../services/wordsService.js'
import { translateContents, autofillData } from '../services/aiService.js'
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
  const { words } = req.body
  let jsonArray = []

  for (const word of words) {
    const result = await doesWordExist(word)
  
    if (!result.success) {
      return res.status(500).json({
        error: 'Database error'
      })
    }
  
    const data = autofillData(word)
  
    if (!data) {
      return res.status(500).json({
        error: 'Failed to generate word data'
      })
    }
  
    jsonArray.push({
      action: result.exists ? 'warn' : 'ok',
      similar: result.similar,
      data
    })
  }

  return res.json(jsonArray)
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