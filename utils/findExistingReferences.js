import { doesWordExist } from "../services/wordsService.js"

export async function findExistingReferences(words, language) {
  //Get an array of "doesWordExist()" results
  const results = await Promise.all(
    words.map(word => doesWordExist(word, language))
  )

  //Filter array and only return the array of similar words stored in results
  return results
    .filter(result => result.exists)
    .map(result => result.similar)
}