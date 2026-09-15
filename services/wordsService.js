import { pool } from '../db/connection.js'
import { translateContents } from '../services/aiService.js'
import { categorizeWordPairs } from '../services/aiService.js'
import { isArrayAndPopulated, escapeRegex } from '../utils/common.js'

//words
export async function getWordBank(req, res) {
  //Return all words
  try {
    const [result] = await pool.query('SELECT * FROM wordbank;')
    res.status(200).json(result)
  }
  catch (err) {
    console.error(err)

    res.status(500).json({
      error: 'Database error'
    })
  }
}

//words/translate
export async function translate(req, res) {
  const { contents, langFrom } = req.body

  try {
    const response = await translateContents(contents, langFrom)

    if (!response.success) {
      const message = response.message
      return res.status(response.status).json({ message })
    }

    const translation = response.translation
    res.json({ translation })
  }
  catch (err) {
    console.error(err)

    res.status(500).json({
      message: 'Unexpected error encountered; Translation failed'
    })
  }
}

//words/references
export async function getExistingReferences(req, res) {
  const { wordPairs } = req.body //wordPairs: Array<{ es: string, en: string }>

  try {
    const result = await initExistingReferences(wordPairs)
    if (!result.success) {
      return res.status(500).json({ message: result.message })
    }
    res.json({ existingReferences: result.existingReferences }) //existingReferences: Array<{ initialized: true, spanish, english, shared }>
  }
  catch (err) {
    return res.status(500).json({ message: err.message })
  }
}

//wordPairs: Array<{ id, es, en }>
async function initExistingReferences(wordPairs) {
  if (!isArrayAndPopulated(wordPairs)) {
    return {
      success: false,
      status: 500,
      message: 'No data provided to check for existing references'
    }
  }

  try {
    /*
      Create one set of queries for each wordPair.

      Each wordPair can have:
        - an es value
        - an en value
        - both
        - neither

      Missing/empty values simply don't generate a query.
    */
    const referenceChecks = wordPairs.map(wordPair => {
      const checks = {
        id: wordPair.id,
        spanishPattern: null,
        englishPattern: null
      }

      /*
        Build the Spanish regex if an "es" value was provided.

        "Maestra" would become:
          (^| / )(Maestra|Maestro/a)( / |$)
        "Profesor" would become:
          (^| / )(Profesor|Profesor(a))( / |$)

        Each word is escaped first so regex characters in the
        supplied text are treated literally.
      */
      if (wordPair.es) {
        const words = wordPair.es
          .split(' / ')
          .map(escapeRegex)
          .map(word => {
            const wordLC = word.toLowerCase()
            {
              const lastChar = wordLC.slice(-1)
              if (lastChar === 'o' || lastChar === 'a') {
                return word + '|' + word.slice(0, -1) + 'o/a'
              }
            }
            if (wordLC.slice(-2) === 'or') {
              return word + '(\\(a\\))?'
            }
            return word
          })

        checks.spanishPattern =

          `(^| / )(${words.join('|')})( / |$)`
      }

      /*
        Build the English regex if an "en" value was provided.
      */
      if (wordPair.en) {
        const words = wordPair.en
          .split(' / ')
          .map(escapeRegex)

        checks.englishPattern =
          `(^| / )(${words.join('|')})( / |$)`
      }

      // console.log(checks)
      return checks
    })


    /*
      Run the Spanish and English checks for each wordPair.

      Each wordPair gets its own result, so the database results
      remain associated with the correct request ID.

      If a field is empty, Promise.resolve([]) gives us an empty
      result instead of making an unnecessary database query.
    */
    const results = await Promise.all(
      referenceChecks.map(async check => {
        const [
          spanishResult,
          englishResult
        ] = await Promise.all([
          check.spanishPattern
            ? pool.query(`
                SELECT id, spanish, english
                FROM wordbank
                WHERE spanish REGEXP ?;
              `, [check.spanishPattern])
            : Promise.resolve([[]]),

          check.englishPattern
            ? pool.query(`
                SELECT id, spanish, english
                FROM wordbank
                WHERE english REGEXP ?;
              `, [check.englishPattern])
            : Promise.resolve([[]])
        ])


        /*
          pool.query() returns:
            [rows, fields]

          We only need the rows.
        */
        const spanishReferences = spanishResult[0]
        const englishReferences = englishResult[0]


        /*
          Find records that are referenced by BOTH the Spanish
          and English values for this particular wordPair.
        */
        const spanishReferenceIDs = new Set(
          spanishReferences.map(ref => ref.id)
        )

        const englishReferenceIDs = new Set(
          englishReferences.map(ref => ref.id)
        )

        const sharedReferenceIDs = new Set(
          [...spanishReferenceIDs]
            .filter(id => englishReferenceIDs.has(id))
        )


        /*
          Separate the results into:
            - spanish: referenced only by the Spanish value
            - english: referenced only by the English value
            - shared: referenced by both values
        */
        const existingReferences = {
          initialized: true,

          spanish: spanishReferences.filter(
            record => !sharedReferenceIDs.has(record.id)
          ),

          english: englishReferences.filter(
            record => !sharedReferenceIDs.has(record.id)
          ),

          shared: spanishReferences.filter(
            record => sharedReferenceIDs.has(record.id)
          )
        }


        /*
          Return the original request ID along with its references.
        */
        return {
          id: check.id,
          existingReferences
        }
      })
    )


    return {
      success: true,
      existingReferences: results
    }
  }
  catch (err) {
    console.error('Failed to initialize existing references:', err)

    const message = (err.errorno === 'ETIMEDOUT') ?
      'Database connection could not be established' :
      err.message

    return {
      success: false,
      message
    }
  }
}

//words/stage
export async function stageWords(req, res) {
  const { wordPairs } = req.body
  // Array<{ id: string, es: string, en: string }>

  try {
    /*
      categorizeWordPairs() returns one or more rows for each source
      wordPair. Each generated row contains:
        - sourceId: original input ID
        - rowId: unique ID for this generated sense
        - record: the 13 database fields
        - existingReferences: null

      Use rowId for reference lookup because each distinct sense needs
      its own existing-reference result.
    */
    const wordRowsResult = await categorizeWordPairs(wordPairs)

    if (!wordRowsResult.success) {
      return res.status(500).json({
        message: wordRowsResult.message
      })
    }

    /*
      Check existing references for every generated sense in one batch.

      getExistingReferences() / initExistingReferences() expects:
        { id, es, en }

      Use the generated rowId as the lookup ID so the result can later
      be mapped directly back to the correct generated row.
    */
    const referenceWordPairs = wordRowsResult.rows.map(row => ({
      id: row.rowId,
      es: row.record.spanish,
      en: row.record.english
    }))

    const existingReferencesResult =
      await initExistingReferences(referenceWordPairs)

    /*
      If reference initialization fails for the entire batch, preserve
      the staged records and mark their references as uninitialized.
    */
    if (!existingReferencesResult.success) {
      const enrichedWordRows = wordRowsResult.rows.map(row => ({
        sourceId: row.sourceId,
        rowId: row.rowId,
        record: row.record,

        existingReferences: {
          initialized: false,
          message:
            existingReferencesResult.message ??
            'Failed to initialize existing references'
        }
      }))

      return res.json({
        rows: enrichedWordRows
      })
    }

    /*
      Map reference results by rowId so each generated sense gets the
      references belonging specifically to that sense.
    */
    const existingReferencesById = new Map(
      existingReferencesResult.existingReferences.map(result => [
        result.id,
        result.existingReferences
      ])
    )

    /*
      Attach the matching references to each generated row.

      sourceId identifies the original input word pair.
      rowId identifies this specific generated sense.
    */
    const enrichedWordRows = wordRowsResult.rows.map(row => {
      const references = existingReferencesById.get(row.rowId)

      return {
        sourceId: row.sourceId,
        rowId: row.rowId,
        record: row.record,

        existingReferences:
          references ??
          {
            initialized: false,
            message: 'No existing-reference result found for this row'
          }
      }
    })

    return res.json({
      rows: enrichedWordRows
    })
  }
  catch (err) {
    console.error(err)

    return res.status(500).json({
      message: 'Unexpected error encountered; Word staging failed'
    })
  }
}

//words/commit
export async function commitWords(req, res) {
  const { wordRows } = req.body
  const fields = Object.keys(wordRows[0])
  const placeholders = wordRows
    .map(() =>
      '(' + fields.map(() => '?').join(',') + ')'
    )
    .join(',')

  const sql = `INSERT INTO wordbank (${fields.join(',')}) VALUES ${placeholders};`

  try {
    pool.query(sql, wordRows.flatMap(row => Object.values(row)))
  }
  catch (err) {
    console.error(err)
    return res.status(500).json({ message: 'Database error' })
  }

  return res.json({ message: `${wordRows.length} word row(s) added successfully` })
}