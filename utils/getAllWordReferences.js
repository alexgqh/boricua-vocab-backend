import { getWordReferences } from '../services/wordsService.js'

export async function getAllWordReferences(words, language) {
  //Get an array of results
  const results = await Promise.all(
    words.map(word => getWordReferences(word, language))
  )

  //Filter array and only return the array of similar words stored in results
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
  return results
    .filter(result => result.success && result.exists)
    .map(result => result.references)
}