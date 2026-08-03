import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../authorization/authorization.middleware.js';
import { Permissions } from '../authorization/permission.constants.js';
import { generateVideoAnalyticsPdfReport } from './report.service.js';

const router = express.Router();

router.get('/video-analytics.pdf', requireAuth, requirePermission(Permissions.REPORTS_ANALYTICS_EXPORT), async (req, res) => {
  try {
    const { pdfBuffer, filename } = await generateVideoAnalyticsPdfReport({
      range: req.query.range,
      from: req.query.from,
      to: req.query.to,
      groupBy: req.query.groupBy,
      includePrivate: req.query.includePrivate,
      timezone: req.query.timezone || 'UTC',
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF report error:', err);
    return res.status(500).json({
      message: err.message || 'Failed to generate PDF report',
    });
  }
});

export default router;
