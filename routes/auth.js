import { Router } from "express";
import { authenticateSession, loginUser, registerUser, requireUser } from "../services/authService.js";
import { loginLimiter, registrationLimiter } from "../middleware/rateLimits.js";

const router = Router()

router.post('/register', registrationLimiter, registerUser)
router.get('/me', requireUser, authenticateSession)
router.post('/login', loginLimiter, loginUser)

export default router