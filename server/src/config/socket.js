import jwt from 'jsonwebtoken';
import Ride from '../models/Ride.js';
import User from '../models/User.js';
import { updateLocation } from '../services/driverService.js';
import { RIDE_VIEW_ROLES } from '../utils/roles.js';

const ACTIVE_RIDE_TTL_MS = 15000;

const validCoord = (lat, lng) =>
  Number.isFinite(Number(lat)) &&
  Number.isFinite(Number(lng)) &&
  Math.abs(Number(lat)) <= 90 &&
  Math.abs(Number(lng)) <= 180;

const isLiveRideViewer = (role) => RIDE_VIEW_ROLES.includes(role);

export const initSocket = (io) => {
  // JWT auth for sockets — a verified access token is required to act as a
  // specific user. Sockets without a token stay anonymous (public pages) and
  // can never join user/ride rooms or emit locations.
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (token) {
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const user = await User.findById(payload.id).select(
          'role isSuspended isApproved tokenVersion',
        );
        if (!user || user.isSuspended || user.tokenVersion !== payload.v) {
          return next(new Error('UNAUTHORIZED'));
        }
        socket.userId = String(user._id);
        socket.role = user.role;
        socket.isApproved = !!user.isApproved;
        return next();
      }
      return next(); // anon for public pages
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const joinRoleRooms = () => {
      if (socket.userId) socket.join(`user:${socket.userId}`);
      // An unapproved driver may connect (to see their status) but must never
      // appear in the drivers room or receive ride offers.
      if (socket.role === 'driver' && socket.isApproved) socket.join('drivers');
      if (isLiveRideViewer(socket.role)) socket.join('admins');
    };

    const leaveRoleRooms = () => {
      if (socket.userId) socket.leave(`user:${socket.userId}`);
      socket.leave('drivers');
      socket.leave('admins');
    };

    const associate = async (payload = {}) => {
      const { token } = payload || {};
      if (!token) return;
      try {
        const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const user = await User.findById(decoded.id).select(
          'role isSuspended isApproved tokenVersion',
        );
        if (!user || user.isSuspended || user.tokenVersion !== decoded.v) return;
        leaveRoleRooms();
        socket.userId = String(user._id);
        socket.role = user.role;
        socket.isApproved = !!user.isApproved;
        socket.data.activeRide = null;
        joinRoleRooms();
      } catch {
        /* invalid re-auth is ignored; existing identity stays */
      }
    };

    if (socket.userId) joinRoleRooms();
    socket.on('authenticate', associate);

    // Join a ride-scoped room so passenger + driver share live events. Only the
    // ride's passenger, its assigned driver, or a live-dispatch role may join
    // (location data flows through these rooms).
    socket.on('ride:join', async ({ rideId } = {}) => {
      if (!rideId || !socket.userId) return;
      const ride = await Ride.findOne({ _id: rideId }).select('passenger driver').lean();
      if (!ride) return;
      const isParticipant =
        String(ride.passenger) === String(socket.userId) ||
        (ride.driver && String(ride.driver) === String(socket.userId));
      if (isLiveRideViewer(socket.role) || isParticipant) socket.join(`ride:${rideId}`);
    });

    const activeRideCache = (role) => {
      const cached = socket.data?.activeRide;
      if (cached && cached.role === role && Date.now() - cached.at < ACTIVE_RIDE_TTL_MS) {
        return cached;
      }
      return null;
    };
    const setActiveRideCache = (role, rideId) => {
      socket.data = socket.data || {};
      socket.data.activeRide = { role, rideId, at: Date.now() };
    };

    // Driver publishes position. It is persisted (so dispatch/nearby searches
    // see live positions) and forwarded only to the ride room they are serving.
    socket.on('driver:location', async ({ lat, lng, heading = 0, speed = 0 } = {}) => {
      const driverId = socket.userId;
      if (!driverId || socket.role !== 'driver' || !socket.isApproved) return;
      if (!validCoord(lat, lng)) return;
      // Server-side throttle: a misbehaving client must not turn every emitted
      // sample into a Mongo upsert. The portal already sends 1 per 2 s.
      const now = Date.now();
      if (now - (socket.data.lastDriverLocationAt || 0) < 2000) return;
      socket.data.lastDriverLocationAt = now;

      const position = {
        lat: Number(lat),
        lng: Number(lng),
        heading: Number(heading) || 0,
        speed: Number(speed) || 0,
      };

      updateLocation(driverId, position).catch(() => {});

      let cached = activeRideCache('driver');
      if (!cached) {
        const activeRide = await Ride.findOne({
          driver: driverId,
          status: { $in: ['accepted', 'arriving', 'in_progress'] },
        }).select('_id').lean();
        cached = { rideId: activeRide?._id || null };
        setActiveRideCache('driver', cached.rideId);
      }

      if (cached.rideId) {
        io.to(`ride:${cached.rideId}`).emit('driver:location', { driverId, ...position });
      }
    });

    // Passenger publishes position -> forward to the ride room so the assigned
    // driver can find them live (mirror of driver:location).
    socket.on('passenger:location', async ({ lat, lng, heading = 0, speed = 0 } = {}) => {
      const passengerId = socket.userId;
      if (!passengerId || socket.role !== 'passenger') return;
      if (!validCoord(lat, lng)) return;
      const now = Date.now();
      if (now - (socket.data.lastPassengerLocationAt || 0) < 2000) return;
      socket.data.lastPassengerLocationAt = now;

      const position = {
        lat: Number(lat),
        lng: Number(lng),
        heading: Number(heading) || 0,
        speed: Number(speed) || 0,
      };

      let cached = activeRideCache('passenger');
      if (!cached) {
        const activeRide = await Ride.findOne({
          passenger: passengerId,
          status: { $in: ['accepted', 'arriving', 'in_progress'] },
        }).select('_id').lean();
        cached = { rideId: activeRide?._id || null };
        setActiveRideCache('passenger', cached.rideId);
      }

      if (cached.rideId) {
        io.to(`ride:${cached.rideId}`).emit('passenger:location', { passengerId, ...position });
      }
    });

    // Uber-like live chat: passenger ↔ driver in ride room (only participants).
    // The document is capped at the newest 200 messages so a long ride cannot
    // grow toward Mongo's 16MB limit.
    socket.on('ride:message', async ({ rideId, text } = {}) => {
      if (!rideId || !text || !socket.userId) return;
      const now = Date.now();
      if (now - (socket.data.lastMessageAt || 0) < 1000) return;
      const trimmed = String(text).trim().slice(0, 500);
      if (!trimmed) return;
      socket.data.lastMessageAt = now;
      const ride = await Ride.findOne({ _id: rideId }).select('passenger driver').lean();
      if (!ride) return;
      const isParticipant =
        String(ride.passenger) === String(socket.userId) ||
        (ride.driver && String(ride.driver) === String(socket.userId));
      if (!isParticipant) return;

      const at = new Date();
      await Ride.findByIdAndUpdate(rideId, {
        $push: {
          messages: {
            $each: [{ sender: socket.userId, text: trimmed, at }],
            $slice: -200,
          },
        },
      });
      io.to(`ride:${rideId}`).emit('ride:message', {
        rideId,
        sender: socket.userId,
        text: trimmed,
        at,
        senderRole: socket.role,
      });
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};
