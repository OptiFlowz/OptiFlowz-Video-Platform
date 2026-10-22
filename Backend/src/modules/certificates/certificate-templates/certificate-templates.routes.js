import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

export default router;
