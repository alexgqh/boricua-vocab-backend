import { Router } from "express";
import { registerUser } from "../services/authService.js";

const router = Router()

router.post('/register', registerUser)

export default router