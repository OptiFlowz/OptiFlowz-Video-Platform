import express from 'express';
import rateLimit from 'express-rate-limit';
import certificateTemplatesRoutes from './certificate-templates/certificate-templates.routes.js';
import { requireAuth } from '../../middleware/auth.js';
import { getCertificates, getCertificate, getCertificatePdf } from './certificates.controller.js';

const router = express.Router();

router.use('/certificate-templates', certificateTemplatesRoutes);
router.get('/', requireAuth, getCertificates);
router.get('/:id/pdf', rateLimit({
  windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { success: false, message: 'Too many certificate PDF requests; retry in a minute' },
}), getCertificatePdf);
router.get('/:id', getCertificate);

export default router;
