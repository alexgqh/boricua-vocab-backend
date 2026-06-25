import { getExistingReferences } from '../services/wordsService.js'

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
export async function getAllExistingReferences(words, language) {
  //Get an array of results
  const results = await Promise.all(
    words.map(word => getExistingReferences(word, language))
  )

  //Filter array and return relevant fields
  const references = results //array of { id, spanish, english }
    .filter(result => result.success && result.exists)
    .map(result => result.references)
    .flat()

  //Make sure there are no duplicates (can happen with "Pickup / Truck" for example -- both words return the "Pickup truck" record)
  const seen = new Set()
  const uniqueReferences = references.filter(reference => {
    if (seen.has(reference.id)) {
      return false
    }
    seen.add(reference.id)
    return true
  })

  return uniqueReferences
}