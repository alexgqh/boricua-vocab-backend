import { GoogleGenAI } from '@google/genai'
import fs from 'node:fs'

const ai = new GoogleGenAI({}) //automatically reads api key from .env

async function runPrompt(prompt, expectedType) {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    })

    //Validate result type
    {
      const correctType = (typeof response.text === expectedType)
      if (!correctType) {
        return {
          success: false,
          message:
            `Invalid AI output (
            \tExpected: ${expectedType}
            \tReceived: ${typeof response.text}
          )`
        }
      }
    }

    //Success! Return reseponse text
    return {
      success: true,
      response: response.text
    }
  }
  catch (err) {
    console.error(err)

    return {
      success: false,
      message: 'AI request failed'
    }
  }
}
function handlePromptResults(result, responseFieldName) {
  if (!result.success) {
    return {
      success: false,
      status: 500,
      message: result.message
    }
  }

  return {
    success: true,
    [responseFieldName]: result.response
  }
}

export async function translateContents(contents, langFrom) {
  if (!contents?.trim() || !langFrom?.trim()) {
    return {
      success: false,
      status: 400,
      message: 'Invalid parameters provided'
    }
  }
  const from = langFrom === 'es' ? 'Boricua Spanish' : 'English'
  const to = langFrom === 'es' ? 'English' : 'Boricua Spanish'
  const prompt = fs.readFileSync('prompts/translateWord.txt', 'utf8')
    .replace(/<LANG_FROM>/g, from)
    .replace(/<LANG_TO>/g, to)
    .replace(/<CONTENTS>/g, contents)

  const result = await runPrompt(prompt, 'string')
  return handlePromptResults(result, 'translation')
}

export async function categorizeWordPairs(wordPairs) {
  const data = wordPairs.filter(pair => pair.en?.trim() || pair.es?.trim())
  if (data.length === 0) {
    return {
      success: false,
      status: 400,
      message: 'No valid word pairs provided'
    }
  }

  const prompt = fs.readFileSync('prompts/translateWord.txt', 'utf8').replace(/<INPUT>/g, data)
  const result = await runPrompt(prompt, 'object')
  return handlePromptResults(result, 'rows')
}