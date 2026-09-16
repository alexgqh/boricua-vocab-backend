import { Router } from 'express'
import { getWordBank } from '../services/wordsService.js'
import { requireAdmin } from '../services/authService.js'
import { translate, getExistingReferences, stageWords, commitWords } from '../services/wordsService.js'

const router = Router()

router.get('/', getWordBank)

router.post('/translate', translate)
router.post('/references', requireAdmin, getExistingReferences)

router.post('/stage', requireAdmin, stageWords)
router.post('/commit', requireAdmin, commitWords)

export default router