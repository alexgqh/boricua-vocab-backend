//Number of milliseconds per unit of time
export const MS_IN_SEC = 1000
export const MS_IN_MIN = MS_IN_SEC * 60
export const MS_IN_HR = MS_IN_MIN * 60
export const MS_IN_DAY = MS_IN_HR * 24
export const MS_IN_WEEK = MS_IN_DAY * 7
export const MS_IN_YEAR = MS_IN_DAY * 365

export const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))
export const isArrayAndPopulated = (obj) => Array.isArray(obj) && obj.length > 0
export const escapeRegex = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')