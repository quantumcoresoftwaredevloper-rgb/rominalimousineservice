// Async route wrapper - avoids try/catch boilerplate in controllers
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (req, res, _next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

// An error is "safe to show" only when a handler deliberately set statusCode,
// meaning it raised a client-facing message on purpose. Anything else is an
// unhandled 5xx and its message is internal.
const isClientError = (err) => Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 500;

export const errorHandler = (err, req, res, _next) => {
  let status = isClientError(err) ? err.statusCode : 500;
  let message = isClientError(err) ? err.message : 'Server error';

  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }
  if (err.code === 11000) {
    status = 400;
    message = `Duplicate value: ${Object.keys(err.keyValue).join(', ')}`;
  }
  // CastError/geo errors used to echo err.value and the Mongoose path straight
  // back. POST /api/drivers/location with {"lat":null} returned the raw
  // MongoServerError text, disclosing collection names, ObjectIds and the
  // geo index shape. Name the field, never the value.
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  }

  console.error(err);

  // Unhandled 5xx: log the detail, return nothing about internals.
  if (status >= 500) {
    return res.status(status).json({
      message: 'Something went wrong on our end. Please try again.',
    });
  }
  res.status(status).json({ message });
};