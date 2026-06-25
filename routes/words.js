import { Router } from 'express'
import { getWordBank } from '../services/wordsService.js'
import { authenticateAdmin, isAdminAuthenticated } from '../services/authService.js'
import { translate, stageWords, commitWords, getDropdownOptions } from '../services/wordsService.js'

const router = Router()

router.get('/', getWordBank)
router.get('/dropdown-options', getDropdownOptions)

router.post('/translate', translate)

router.post('/stage', stageWords)
router.post('/commit', commitWords)

export default router