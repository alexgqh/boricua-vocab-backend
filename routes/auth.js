import { Router } from "express";
import { authenticateSession, registerUser, requireUser } from "../services/authService.js";

const router = Router()

router.post('/register', registerUser)
router.get('/me', requireUser, authenticateSession)

export default router