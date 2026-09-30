import { Router } from 'express'
import { authenticateAdmin, isAdminAuthenticated } from '../services/authService.js'
import { adminLoginLimiter } from '../middleware/rateLimits.js'

const router = Router()

router.post('/login', adminLoginLimiter, authenticateAdmin)
router.get('/session', isAdminAuthenticated)

export default router