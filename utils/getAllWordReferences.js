import { getWordReferences } from '../services/wordsService.js'

export async function getAllWordReferences(words, language) {
  //Get an array of results
  const results = await Promise.all(
    words.map(word => getWordReferences(word, language))
  )

  //Filter array and only return the array of similar words stored in results
  return results
    .filter(result => result.exists)
    .map(result => result.references)
}