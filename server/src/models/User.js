import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const tokenSubSchema = new mongoose.Schema(
  {
    token: { type: String },
    expiresAt: { type: Date },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ['passenger', 'driver', 'admin', 'super_admin', 'dispatcher', 'manager', 'finance', 'support'], default: 'passenger' },
    avatar: { type: String, default: '' },
    emailVerified: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    // Drivers must be approved by an admin before they can go online / receive rides.
    isApproved: { type: Boolean, default: false },
    // Web-push subscriptions (endpoint + VAPID keys) for browser notifications
    pushSubscriptions: [
      {
        endpoint: { type: String, required: true },
        keys: {
          p256dh: String,
          auth: String,
        },
      },
    ],
    // Incremented on logout / password reset to invalidate outstanding JWTs
    tokenVersion: { type: Number, default: 1 },
    verificationToken: { type: tokenSubSchema, default: null },
    resetToken: { type: tokenSubSchema, default: null },
    authProvider: {
      type: String,
      enum: ['local', 'google', 'facebook', 'phone'],
      default: 'local',
    },
    driverDetails: {
      vehicleType: {
        type: String,
        // Retains the full marketing catalogue so existing data and imported
        // records stay valid. Only 'SUV' and 'Chevrolet' are bookable and only
        // those are assignable through admin — see
        // adminUserService.VEHICLE_TYPES.
        enum: [
          'executive-sedan',
          'economy-sedan',
          'economy-suv',
          'premium-suv',
          'luxury-suv',
          'SUV',
          'Chevrolet',
          'van',
          'mini-coach',
          'school-bus',
          'motorcoach',
        ],
        // Must default to a bookable class. It defaulted to 'economy-sedan',
        // which no ride can request — a driver registered without an explicit
        // vehicle (any API client, or the form with the toggle left unset) got
        // a class dispatch could never match them on.
        default: 'SUV',
      },
      plateNumber: { type: String, default: '' },
      licenseNo: { type: String, default: '' },
      // Free-text vehicle model/name (e.g. "Chevrolet Suburban") shown to admin.
      vehicleName: { type: String, default: '' },
      isAvailable: { type: Boolean, default: false },
      // Uber-like driver metrics
      stats: {
        totalRides: { type: Number, default: 0 },
        rating: { type: Number, default: 0 }, // average 0-5
        ratingCount: { type: Number, default: 0 },
        compliments: {
          clean: { type: Number, default: 0 },
          professional: { type: Number, default: 0 },
          friendly: { type: Number, default: 0 },
          safe: { type: Number, default: 0 },
        },
      },
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password);
};

userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email }).select('+password');
};

userSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone }).select('+password');
};

userSchema.statics.findByLogin = function (identifier) {
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
  return isEmail ? this.findByEmail(identifier) : this.findByPhone(identifier);
};

const User = mongoose.model('User', userSchema);
export default User;