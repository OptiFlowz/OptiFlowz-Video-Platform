import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { generateVideoAnalyticsPdfReport } from './report.service.js';

const router = express.Router();

router.get('/video-analytics.pdf', requireAuth, requireAdmin, async (req, res) => {
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