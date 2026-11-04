import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { getFlight, flightStatus } from '../controllers/flightController.js';

const router = Router();
router.use(protect);
router.get('/status', flightStatus);
router.get('/:ident', getFlight);

export default router;
