import { Router } from 'express'
import { authenticateAdmin, isAdminAuthenticated } from '../services/authService.js'

const router = Router()

router.post('/login', authenticateAdmin)
router.get('/session', isAdminAuthenticated)

export default router