// Create the first production administrator without wiping data.
//
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-unique-password' npm run admin:create
//
// If the email already exists the account is promoted to admin and its password
// is left untouched (use password reset from the app to rotate it).
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import { PASSWORD_MIN } from '../src/services/authService.js';

const run = async () => {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Administrator').trim() || 'Administrator';

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_EMAIL to a valid email address');
  }
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');

  await mongoose.connect(process.env.MONGO_URI);
  const existing = await User.findByEmail(email);
  if (existing) {
    existing.role = 'admin';
    existing.isSuspended = false;
    await existing.save();
    console.log(`Promoted existing account ${email} to admin (password unchanged).`);
  } else {
    if (password.length < PASSWORD_MIN) {
      throw new Error(`Set ADMIN_PASSWORD to at least ${PASSWORD_MIN} characters`);
    }
    await User.create({
      name,
      email,
      password,
      role: 'admin',
      emailVerified: true,
    });
    console.log(`Created admin account ${email}.`);
  }
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
