import { GoogleGenAI } from '@google/genai'
import fs from 'node:fs'

const ai = new GoogleGenAI({})

async function translateContents(contents, langFrom) {
  const from = langFrom === 'sp' ? 'Boricua Spanish' : 'English'
  const to = langFrom === 'sp' ? 'English' : 'Boricua Spanish'
  const prompt = fs.readFileSync('prompts/translateWord.txt', 'utf8')
    .replace(/<LANG_FROM>/g, from)
    .replace(/<LANG_TO>/g, to)
    .replace(/<CONTENTS>/g, contents)

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt
  })

  return response.text
}

function autofillData(word) {
  return {
    spanish: word,
    gender: '',
    gender_type: '',
    english: '',
    literal: '',
    part_of_speech: 0,
    theme: 0,
    difficulty: 0,
    note: '',
    example: '',
    example_translation: '',
    vulgar: 0,
    loan_word: 0
  }
}

export { translateContents, autofillData }