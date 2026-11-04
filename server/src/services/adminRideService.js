import Ride from '../models/Ride.js';
import Payment from '../models/Payment.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

const ALLOWED_STATUSES = ['pending', 'scheduled', 'accepted', 'arriving', 'in_progress', 'completed', 'cancelled', 'no_show'];

// Admin/dispatch ride control: cancel, complete, re-open to the board, or
// adjust the final fare. Emissions/logs are handled by the controller.
export const adminUpdateRide = async (rideId, body = {}) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw fail('Ride not found', 404);
  if (ride.status === 'refunded') throw fail('Refunded rides cannot be modified', 400);

  if (body.fareFinal !== undefined) {
    const n = Number(body.fareFinal);
    if (!Number.isFinite(n) || n < 0) throw fail('Invalid final fare', 400);
    const next = Math.round(n * 100) / 100;
    // Once any money is due or collected the fare is frozen: changing it here
    // would silently disagree with the Payment row and the passenger's receipt.
    const settled = await Payment.findOne({
      ride: ride._id,
      status: { $in: ['succeeded', 'cash_due', 'cash_collected', 'cash', 'refunded'] },
    }).select('status amount');
    if (settled && Math.abs(settled.amount - next) > 0.001) {
      throw fail('The fare is already settled. Issue a refund/adjustment instead of editing the fare.', 409);
    }
    ride.fare.final = next;
  }

  if (body.status !== undefined) {
    const status = body.status;
    if (!ALLOWED_STATUSES.includes(status)) throw fail('Invalid ride status', 400);
    if (status === 'completed' && !['accepted', 'arriving', 'in_progress'].includes(ride.status)) {
      throw fail('Cannot complete a ride that is not active', 400);
    }
    if (status === 'cancelled' && ['completed', 'cancelled'].includes(ride.status)) {
      throw fail('Ride is already finished', 400);
    }
    if (status === 'accepted' && !ride.driver) {
      throw fail('Assign a driver before accepting the ride', 400);
    }

    ride.status = status;
    if (status === 'pending') {
      ride.driver = null;
      ride.timestamps.accepted = undefined;
    }
    const tsKey =
      status === 'arriving' ? 'arrived'
      : status === 'in_progress' ? 'started'
      : status === 'no_show' ? 'noShow'
      : status;
    if (['arriving', 'in_progress', 'completed', 'cancelled', 'no_show'].includes(status)) {
      ride.timestamps[tsKey] = new Date();
    }
    if (status === 'cancelled') ride.cancelReason = String(body.cancelReason ?? 'Cancelled by dispatch');
    if (status === 'no_show') ride.noShowReason = String(body.noShowReason ?? 'No-show at pickup');
    if (status === 'completed' && body.fareFinal === undefined) ride.fare.final = ride.fare.estimated;
  }

  await ride.save();
  return Ride.findById(rideId).populate('passenger driver', 'name phone avatar driverDetails');
};