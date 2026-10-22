import express from 'express';
import { requireAuth } from '../../../middleware/auth.js';
import * as certificateTemplatesController from './certificate-templates.controller.js';

const router = express.Router();

router.use(requireAuth);
router.post('/', certificateTemplatesController.createCertificateTemplate);
router.get('/', certificateTemplatesController.getCertificateTemplates);
router.get('/:id', certificateTemplatesController.getCertificateTemplate);
router.patch('/:id', certificateTemplatesController.updateCertificateTemplate);
router.delete('/:id', certificateTemplatesController.deleteCertificateTemplate);

export default router;
