import express from 'express';
import certificateTemplatesRoutes from './certificate-templates/certificate-templates.routes.js';
import { requireAuth } from '../../middleware/auth.js';
import { getCertificates, getCertificate } from './certificates.controller.js';

const router = express.Router();

router.use('/certificate-templates', certificateTemplatesRoutes);
router.get('/', requireAuth, getCertificates);
router.get('/:id', requireAuth, getCertificate);

export default router;
