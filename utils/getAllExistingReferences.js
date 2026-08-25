import { getExistingReferences } from '../services/wordsService.js'
import { isArrayAndPopulated } from './common.js'

/*
  results: an array of an array of wordbank records (one inner array for each word provided as a param to this function)
  example:
    >input: ["Guagua", "Prieto", "asdf"]
    >output: [
      [{ spanish: "Guagua", english: "Bus", part_of_speech: 1, ...}],
      [
        { spanish: "Prieto", english: "Tight / Compressed / Dark-colored", ... },
        { spanish: "Chavo prieto", english: "Penny", ... },
        { spanish: "Café prieto", english: "Black coffee", ... }
      ],
      []
    ]
*/
//words: Array<string>
export async function getAllExistingReferences(words, language) {
  //Run a query for each word in words to check for existing references
  //results: Array<Array<{ id: number, spanish: string, english: string }>>
  const results = await Promise.all(
    words.map(word => getExistingReferences(word, language)) //Array<{ id, spanish, english }
  )

  //Check for any failed function calls, return error if so
  {
    const failedResults = results.filter(result => !result.success)
    const isFailed = isArrayAndPopulated(failedResults)
    if (isFailed) return {
      success: false,
      message: failedResults[0].message,
      status: 500
    }
  }

  //Filter array and return relevant fields
  const seen = new Set()
  const existingReferences = results
    .filter(result => result.success && result.exists)
    .map(result => result.existingReferences)
    .flat()

    //Make sure there are no duplicates (can happen with "Pickup / Truck" for example -- both words return the "Pickup truck" record)
    .filter(reference => {
      if (seen.has(reference.id)) {
        return false
      }
      seen.add(reference.id)
      return true
    })

  return {
    success: true,
    existingReferences //Array<{ id, spanish, english, shared }>
  }
}