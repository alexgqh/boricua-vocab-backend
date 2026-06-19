import { GoogleGenAI } from '@google/genai'
import fs from 'node:fs'

const ai = new GoogleGenAI({})

async function runPrompt(prompt) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt
  })
  return response.text
}

export async function translateContents(contents, langFrom) {
  const from = langFrom === 'sp' ? 'Boricua Spanish' : 'English'
  const to = langFrom === 'sp' ? 'English' : 'Boricua Spanish'
  const prompt = fs.readFileSync('prompts/translateWord.txt', 'utf8')
    .replace(/<LANG_FROM>/g, from)
    .replace(/<LANG_TO>/g, to)
    .replace(/<CONTENTS>/g, contents)
  
  return await runPrompt(prompt)
}

export async function autofillData(wordPairs) {
  const data = wordPairs.filter(pair => pair.en?.trim() || pair.sp?.trim())
  if (data.length === 0) {
    return []
  }

  const prompt = fs.readFileSync('prompts/translateWord.txt', 'utf8').replace(/<INPUT>/g, input)
  return await runPrompt(prompt)
}