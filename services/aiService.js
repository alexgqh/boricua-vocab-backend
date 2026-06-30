import { GoogleGenAI } from '@google/genai'
import fs from 'node:fs'

const ai = new GoogleGenAI({}) //automatically reads api key from .env

async function runPrompt(prompt) {
  // fs.writeFileSync('prompts/prompt_used.txt', prompt)
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt
    })

    //Validate result type
    {
      const correctType = (typeof response.text === 'string')
      if (!correctType) {
        return {
          success: false,
          message: `Invalid AI output (expected: 'string'; received: '${typeof response.text}')`
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

  const result = await runPrompt(prompt)

  if (!result.success) {
    return {
      success: false,
      status: 500,
      message: result.message
    }
  }

  return {
    success: true,
    translation: result.response
  }
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

  const simplifiedData = data.map(wordPair => {
    return {
      es: wordPair.es,
      en: wordPair.en
    }
  })
  const prompt = fs.readFileSync('prompts/stageWords.txt', 'utf8')
    .replace(/<INPUT>/g, JSON.stringify(simplifiedData))
  const result = await runPrompt(prompt)
  // comment out code above & use code below to save money on Gemini Credits during development :)
  // const result = {
  //   success: true,
  //   response: `[{"spanish":"Medio","gender":null,"gender_type":null,"english":"Half","literal":null,"part_of_speech":3,"theme":1,"difficulty":1,"note":null,"example":null,"example_translation":null,"vulgar":null,"loan_word":null}]`
  // }

  if (!result.success) {
    return {
      success: false,
      status: 500,
      message: result.message
    }
  }

  //Remove JSON format marker (sometimes it generates the response with this...)
  const cleaned =
    result.response
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim()

  //Parse the json - if it fails, return an error
  try {
    return {
      success: true,
      rows: JSON.parse(cleaned)
    }
  }
  catch (err) {
    //Create text file log with the failed output
    fs.writeFileSync('errors/categorizeWordPairs.txt', result.response, 'utf-8')

    return {
      success: false,
      status: 500,
      message: 'Invalid AI output; Not valid JSON'
    }
  }
}