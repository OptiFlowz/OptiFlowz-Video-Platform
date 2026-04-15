import express from 'express';
import { requireAuth , optionalAuth} from '../../middleware/auth.js';
import * as peopleService from './people.service.js';

const router = express.Router();

router.get('/person', optionalAuth, async (req, res) => {
  try {
    const result = await peopleService.getPersonById(req.query.id);
    res.json(result);
  } catch (error) {
    console.error('Person fetch error:', error);
    res.status(error?.status || 500).json({ message: error?.message || 'Failed to fetch person' });
  }
});

router.get('/search', optionalAuth, async (req, res) => {
  try {
    const result = await peopleService.searchPeople(req.query);
    res.json(result);
  } catch (error) {
    console.error('People search error:', error);
    res.status(error?.status || 500).json({ message: error?.message || 'Server error' });
  }
});

export default router;
