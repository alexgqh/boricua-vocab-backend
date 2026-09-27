import { Router } from "express";
import { authenticateSession, registerUser } from "../services/authService.js";

const router = Router()

router.post('/register', registerUser)
router.post('/me', authenticateSession)

export default router