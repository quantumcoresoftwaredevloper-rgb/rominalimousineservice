import { asyncHandler } from '../middleware/error.js';
import { lookupFlight, isFlightTrackingConfigured } from '../services/flightService.js';

export const getFlight = asyncHandler(async (req, res) => {
  const flight = await lookupFlight(req.params.ident);
  res.json({ flight });
});

export const flightStatus = (_req, res) => {
  res.json({ configured: isFlightTrackingConfigured() });
};
