import User from '../models/User.js';
import { passwordPolicyError, logoutAll } from './authService.js';
import RefreshToken from '../models/RefreshToken.js';

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Admin can only manage passenger/driver accounts — staff & admins are protected.
export const MANAGED_ROLES = ['passenger', 'driver'];
// Driver vehicle types. Only these two are bookable (see BOOKING_VEHICLES in
// client/src/data/vehicles.js) and ride matching compares vehicleType exactly,
// so a driver on anything else is invisible to dispatch and can never be
// assigned a ride.
//
// 'SUV' and 'Chevrolet' were missing from this list even though they are the
// only two values the registration and booking forms offer, and they are legal
// on both User and Ride. pickVehicle then silently discarded them — no error,
// the field just reverted — so an admin editing a registered driver silently
// wiped their vehicle class.
export const VEHICLE_TYPES = ['SUV', 'Chevrolet'];

const pickVehicle = (v) => (VEHICLE_TYPES.includes(v) ? v : undefined);
const isStaff = (role) => !MANAGED_ROLES.includes(role);

const sanitizeDriverDetails = (dd = {}) => ({
  vehicleType: pickVehicle(dd.vehicleType) || 'economy-sedan',
  plateNumber: String(dd.plateNumber ?? '').trim(),
  licenseNo: String(dd.licenseNo ?? '').trim(),
  isAvailable: dd.isAvailable === true,
});

// POST /api/admin/users — create a passenger or driver account.
export const createUser = async (body = {}) => {
  const { name, email, phone, password, role = 'passenger', driverDetails } = body;
  if (!name || !String(name).trim()) throw fail('Name is required', 400);
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw fail('Valid email required', 400);
  const policyError = passwordPolicyError(password, { email: cleanEmail, name });
  if (policyError) throw fail(policyError, 400);
  if (!MANAGED_ROLES.includes(role)) throw fail('Role must be passenger or driver', 400);
  if (await User.findOne({ email: cleanEmail })) throw fail('Email already in use', 409);
  const cleanPhone = String(phone ?? '').trim();
  if (cleanPhone && (await User.findOne({ phone: cleanPhone }))) throw fail('Phone already in use', 409);

  const user = await User.create({
    name: String(name).trim(),
    email: cleanEmail,
    phone: cleanPhone,
    password,
    role,
    emailVerified: body.emailVerified === true,
    driverDetails: role === 'driver' ? sanitizeDriverDetails(driverDetails) : undefined,
  });
  return User.findById(user._id).select('-password');
};

// PATCH /api/admin/users/:id — edit name/email/phone/role/password,
// driver details (vehicle type, plate, license, availability), verification, suspension.
export const updateUser = async (userId, body = {}) => {
  const user = await User.findById(userId);
  if (!user) throw fail('User not found', 404);
  if (isStaff(user.role)) throw fail('Staff & admin accounts cannot be edited here', 400);

  if (body.name !== undefined) {
    if (!String(body.name).trim()) throw fail('Name cannot be empty', 400);
    user.name = String(body.name).trim();
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw fail('Valid email required', 400);
    if (await User.findOne({ email, _id: { $ne: userId } })) throw fail('Email already in use', 409);
    user.email = email;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (phone && (await User.findOne({ phone, _id: { $ne: userId } }))) throw fail('Phone already in use', 409);
    user.phone = phone;
  }
  const passwordChanged = body.password !== undefined && body.password !== '';
  if (passwordChanged) {
    const policyError = passwordPolicyError(body.password, { email: user.email, name: user.name });
    if (policyError) throw fail(policyError, 400);
    user.password = body.password; // hashed by the pre-save hook
    // An outstanding reset link must not survive an admin-forced change.
    user.resetToken = null;
  }
  if (body.role !== undefined && body.role !== user.role) {
    if (!MANAGED_ROLES.includes(body.role)) throw fail('Role must be passenger or driver', 400);
    user.role = body.role;
  }
  if (body.emailVerified !== undefined) user.emailVerified = body.emailVerified === true;
  if (body.isSuspended !== undefined) user.isSuspended = body.isSuspended === true;
  // Driver approval. requireApprovedDriver gates every driver-only action on
  // this, and matching only considers isApproved drivers, so an unapproved
  // driver is invisible to dispatch. It was not settable here at all — the only
  // way to set it was PATCH /api/admin/drivers/:id/approve, which the CRM admin
  // UI never called. Admin could tick "Email verified" and "Available" and the
  // driver still could not go online.
  if (body.isApproved !== undefined && user.role === 'driver') {
    // Approval requires a verified email. Without this the verification flow
    // was decorative: anyone could register on a disposable address, be
    // approved as a driver, and never prove control of it.
    if (body.isApproved === true && !user.emailVerified) {
      throw fail('This driver must verify their email before you can approve them', 400);
    }
    user.isApproved = body.isApproved === true;
  }

  const dd = body.driverDetails;
  if (dd && typeof dd === 'object') {
    if (!user.driverDetails) user.driverDetails = {};
    const vt = pickVehicle(dd.vehicleType);
    if (vt) user.driverDetails.vehicleType = vt;
    if (dd.plateNumber !== undefined) user.driverDetails.plateNumber = String(dd.plateNumber).trim();
    if (dd.licenseNo !== undefined) user.driverDetails.licenseNo = String(dd.licenseNo).trim();
    if (dd.isAvailable !== undefined) user.driverDetails.isAvailable = dd.isAvailable === true;
  }

  // Applied last so an "Available" tick in the same request cannot re-enable a
  // driver that is not approved. driverDetails.isAvailable is what renders
  // "On duty / Receiving nearby requests", so leaving it true makes an
  // unapproved driver look live while every action returns 403.
  if (user.role === 'driver' && !user.isApproved) {
    user.driverDetails.isAvailable = false;
  }

  await user.save();

  if (user.isSuspended) {
    await RefreshToken.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
  }
  // A forced password change is the response to a suspected compromise, so the
  // attacker's existing access must die with it. This previously left every
  // stolen session valid.
  if (passwordChanged) {
    await logoutAll(user._id);
  }
  return User.findById(user._id).select('-password');
};
