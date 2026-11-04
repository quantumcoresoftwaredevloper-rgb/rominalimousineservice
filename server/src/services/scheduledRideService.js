import { setInterval, clearInterval } from 'node:timers';
import { promoteDueScheduledRides, findNearbyDrivers, NOTIFY_RADIUS_M } from './rideService.js';
import { notify } from './notificationService.js';

let timer = null;

/**
 * Move due reservations onto the live board and fan out the same events an
 * immediate booking would produce. Runs on a single timer per process; the
 * atomic status predicate makes overlapping runs harmless when multiple API
 * instances are deployed.
 */
export const promoteScheduledRides = async (io) => {
  const promoted = await promoteDueScheduledRides();
  if (!promoted.length) return promoted;

  for (const ride of promoted) {
    io?.to(`ride:${ride._id}`).emit('ride:update', { ride, status: ride.status });
    io?.to('admins').emit('ride:new', { ride });

    if (ride.status === 'pending') {
      const nearby = await findNearbyDrivers({
        lat: ride.pickup.lat,
        lng: ride.pickup.lng,
        radius: NOTIFY_RADIUS_M,
        vehicleType: ride.vehicleType,
      });
      for (const driver of nearby) {
        io?.to(`user:${driver._id}`).emit('ride:new', { ride });
      }
      await notify({
        user: ride.passenger._id,
        type: 'ride',
        title: 'Scheduled pickup is due',
        message: 'Your scheduled chauffeur request is now with dispatch.',
        data: { rideId: ride._id },
        io,
      });
    } else if (ride.driver) {
      await notify({
        user: ride.driver._id,
        type: 'ride',
        title: 'Scheduled pickup starting',
        message: `Your scheduled pickup for ${ride.passenger?.name || 'the passenger'} is due.`,
        data: { rideId: ride._id },
        io,
      });
      await notify({
        user: ride.passenger._id,
        type: 'ride',
        title: 'Chauffeur confirmed',
        message: `${ride.driver.name} is assigned to your scheduled pickup.`,
        data: { rideId: ride._id },
        io,
      });
    }
  }

  return promoted;
};

export const startScheduledRidePromoter = (io, intervalMs = 60 * 1000) => {
  if (timer) return timer;
  timer = setInterval(() => {
    promoteScheduledRides(io).catch((err) => {
      console.error('Scheduled ride promotion failed:', err.message);
    });
  }, intervalMs);
  timer.unref?.();
  return timer;
};

export const stopScheduledRidePromoter = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
