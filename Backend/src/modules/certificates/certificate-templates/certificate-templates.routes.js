import express from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../../middleware/auth.js';
import { requirePermission } from '../../authorization/authorization.middleware.js';
import { Permissions } from '../../authorization/permission.constants.js';
import * as certificateTemplatesController from './certificate-templates.controller.js';

const router = express.Router();

router.use(requireAuth, requirePermission(Permissions.CERTIFICATES_MODERATE));
router.post('/:id/preview/pdf', rateLimit({
  windowMs: 60_000,
  limit: 10,
  keyGenerator: req => req.user.sub,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Too many certificate previews; retry in a minute' },
}), certificateTemplatesController.previewCertificateTemplatePdf);
router.post('/', certificateTemplatesController.createCertificateTemplate);
router.get('/', certificateTemplatesController.getCertificateTemplates);
router.get('/:id', certificateTemplatesController.getCertificateTemplate);
router.patch('/:id', certificateTemplatesController.updateCertificateTemplate);
router.delete('/:id', certificateTemplatesController.deleteCertificateTemplate);

export default router;
