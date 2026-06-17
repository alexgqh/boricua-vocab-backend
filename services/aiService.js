import { GoogleGenAI } from '@google/genai'

const ai = new GoogleGenAI({})

async function translateContents(contents, langFrom) {
  const from = langFrom === 'sp' ? 'Boricua Spanish' : 'English'
  const to = langFrom === 'sp' ? 'English' : 'Boricua Spanish'
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 
      `Translate the following ${from} into natural ${to}, keeping the Puerto Rican cultural context.
      Only include the translation in your response. Your response should have normal sentence casing.
      The ${from} word or phrase to translate is: "${contents}"`
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