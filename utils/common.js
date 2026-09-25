//Number of milliseconds per unit of time
export const MS_IN_SEC = 1000
export const MS_IN_MIN = MS_IN_SEC * 60
export const MS_IN_HR = MS_IN_MIN * 60
export const MS_IN_DAY = MS_IN_HR * 24
export const MS_IN_WEEK = MS_IN_DAY * 7
export const MS_IN_YEAR = MS_IN_DAY * 365

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
export const SYMBOL_REGEX = /[!@#$%^&*()\-+\[\];:'",<.>/?~`|\\]/

export const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
export const isArrayAndPopulated = (obj) => Array.isArray(obj) && obj.length > 0
export const isStringAndNotWhitespace = (obj) => typeof obj === 'string' && obj.trim().length > 0
export const isStringLengthBetween = (min, max, string) => string.length >= min && string.length <= max
export const getArrayOfInvalidCharacters = (string, regex) => {
  const invalidCharArray = string
    .split('')
    .filter(char => !regex.test(char))
  return [...new Set(invalidCharArray)]
}
export const normalizeForProfanityCheck = (string) => {
  return string
    // Normalize Unicode representations.
    // NFKC also converts many compatibility characters such as
    // full-width Latin letters into their ordinary equivalents.
    .normalize('NFKC')
    .toLowerCase()
}
export const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')