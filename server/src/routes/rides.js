import { Router } from 'express';
import { protect, requireRole, requireApprovedDriver } from '../middleware/auth.js';
import * as ride from '../controllers/rideController.js';
import * as payment from '../controllers/paymentController.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Applied to POST / only (not the whole /api/rides path, which would also
// throttle the driver's polling). Keyed per user so one passenger cannot burn
// the shared budget. Each booking triggers Nominatim + OSRM round-trips and
// notifies every admin, so it is expensive enough to deserve its own gate.
const createRideLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_RIDE_CREATE || 10),
  // ipKeyGenerator normalises IPv6 to a /64 subnet. Handing raw req.ip to a
  // custom keyGenerator makes express-rate-limit throw ERR_ERL_KEY_GEN_IPV6 at
  // startup, which crashes the server on boot rather than degrading.
  keyGenerator: (req) => String(req.user?.id || req.user?._id || ipKeyGenerator(req.ip)),
  message: { message: 'Too many booking attempts. Please wait a moment.' },
});

const router = Router();

// All ride routes require auth
router.use(protect);

router.post('/', requireRole('passenger'), createRideLimiter, ride.createRide);
router.get('/available', requireRole('driver'), requireApprovedDriver, ride.availableRides);
router.get('/', ride.listRides);
router.get('/:id', ride.getRide);
router.patch('/:id', requireRole('passenger'), ride.editRide);
router.patch('/:id/accept', requireRole('driver'), requireApprovedDriver, ride.acceptRide);
router.patch('/:id/status', requireRole('driver'), requireApprovedDriver, ride.updateStatus);
router.patch('/:id/cancel', ride.cancelRide);
router.post('/:id/rate', requireRole('passenger'), ride.rateRide);
router.get('/:id/messages', ride.getMessages);
router.post('/:id/messages', ride.postMessage);
router.post('/:rideId/pay', requireRole('passenger'), payment.payRide);
router.post('/:rideId/payment-intent', requireRole('passenger'), payment.createIntent);

export default router;
