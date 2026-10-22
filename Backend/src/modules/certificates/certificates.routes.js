import express from 'express';
import certificateTemplatesRoutes from './certificate-templates/certificate-templates.routes.js';

const router = express.Router();

router.use('/certificate-templates', certificateTemplatesRoutes);

export default router;
