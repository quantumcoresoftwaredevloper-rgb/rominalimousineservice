// Report (and optionally repair) drivers whose vehicle class is not one of the
// two bookable classes. A driver on a legacy catalogue value (e.g.
// `executive-sedan`) is invisible to dispatch and can never accept a ride,
// because ride matching compares `vehicleType` exactly against SUV/Chevrolet.
//
//   npm run db:audit-vehicles
//   npm run db:audit-vehicles -- --fix=SUV
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User.js';

dotenv.config();

const BOOKABLE = ['SUV', 'Chevrolet'];
const fixArg = process.argv.find((arg) => arg.startsWith('--fix='));
const fixTo = fixArg?.split('=')[1];

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (fixArg && !BOOKABLE.includes(fixTo)) {
    throw new Error(`--fix must be one of: ${BOOKABLE.join(', ')}`);
  }

  await mongoose.connect(process.env.MONGO_URI);
  const drivers = await User.find({ role: 'driver' })
    .select('name email driverDetails.vehicleType driverDetails.isAvailable')
    .lean();

  const invalid = drivers.filter(
    (d) => !BOOKABLE.includes(d.driverDetails?.vehicleType)
  );

  console.log(`Drivers: ${drivers.length}`);
  console.log(`Bookable (SUV/Chevrolet): ${drivers.length - invalid.length}`);
  console.log(`Needs attention: ${invalid.length}`);

  for (const d of invalid) {
    console.log(
      `- ${d.email || d._id} (${d.name || 'unnamed'}): ${d.driverDetails?.vehicleType ?? 'missing'}`
    );
  }

  if (invalid.length && fixTo) {
    const result = await User.updateMany(
      { _id: { $in: invalid.map((d) => d._id) } },
      { $set: { 'driverDetails.vehicleType': fixTo } }
    );
    console.log(`Updated ${result.modifiedCount} driver(s) to ${fixTo}.`);
  } else if (invalid.length) {
    console.log(
      'Re-run with --fix=SUV (or --fix=Chevrolet) to assign a bookable class, or edit each driver in Admin → Drivers.'
    );
    process.exitCode = 1;
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
