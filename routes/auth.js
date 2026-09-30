import { Router } from "express";
import { authenticateSession, loginUser, registerUser, requireUser } from "../services/authService.js";

const router = Router()

router.post('/register', registerUser)
router.get('/me', requireUser, authenticateSession)
router.post('/login', loginUser)

export default router