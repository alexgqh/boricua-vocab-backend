import { Router } from 'express'
import { getWordBank } from '../services/wordsService.js'
import { authenticateAdmin, isAdminAuthenticated } from '../services/authService.js'
import { translate, getExistingReferences, stageWords, commitWords } from '../services/wordsService.js'

const router = Router()

router.get('/', getWordBank)

router.post('/translate', translate)
router.post('/references', getExistingReferences)

router.post('/stage', stageWords)
router.post('/commit', commitWords)

export default router