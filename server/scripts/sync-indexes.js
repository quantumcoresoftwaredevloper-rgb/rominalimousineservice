// Builds the indexes declared in the Mongoose schemas. Run after deploying a
// release that adds/changes an index (Mongoose autoIndex should not be relied
// on in production): `npm run db:indexes`.
//
// The two critical guards are:
//   payments.ride_settled_unique      one settled payment per ride
//   rides.driver_active_ride_unique   one active ride per driver
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import '../src/models/User.js';
import '../src/models/Ride.js';
import '../src/models/Payment.js';
import '../src/models/RefundRequest.js';
import '../src/models/Location.js';
import '../src/models/Notification.js';
import '../src/models/AppSetting.js';

dotenv.config();

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  for (const model of mongoose.models ? Object.values(mongoose.models) : []) {
    const name = model.modelName;
    try {
      const result = await model.syncIndexes();
      console.log(`${name}: ${result.length ? result.join(', ') : 'indexes already current'}`);
    } catch (err) {
      console.error(`${name}: FAILED — ${err.message}`);
      process.exitCode = 1;
    }
  }
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
