import { Router } from 'express'
import { authenticate, isAuthenticated } from '../services/authService.js'

const router = Router()

router.post('/login', authenticate)
router.get('/session', isAuthenticated)

export default router