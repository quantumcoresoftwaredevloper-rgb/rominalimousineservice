// Optional live flight-status integration (FlightAware AeroAPI).
//
// The platform works without it: marketing copy only claims that a flight
// number is captured for dispatch coordination. When FLIGHTAWARE_API_KEY is
// configured, staff can look up the current status; otherwise the endpoint
// fails closed with 503 instead of inventing data.
const API_BASE = 'https://aeroapi.flightaware.com/aeroapi';
const IDENT_RE = /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/;

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });

export const isFlightTrackingConfigured = () => Boolean(process.env.FLIGHTAWARE_API_KEY);

const normalizeIdent = (ident) => String(ident || '').trim().toUpperCase();

export const lookupFlight = async (identInput) => {
  const ident = normalizeIdent(identInput);
  if (!IDENT_RE.test(ident)) throw fail('Enter a valid flight number, e.g. UA123', 400);
  if (!isFlightTrackingConfigured()) {
    throw fail('Live flight tracking is not configured for this deployment.', 503);
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/flights/${encodeURIComponent(ident)}?max_pages=1`, {
      headers: {
        'x-apikey': process.env.FLIGHTAWARE_API_KEY,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw fail('Flight status provider is unavailable. Try again shortly.', 502);
  }

  if (res.status === 404) throw fail('Flight not found', 404);
  if (res.status === 401 || res.status === 403) {
    throw fail('Flight status provider rejected the configured credentials.', 503);
  }
  if (!res.ok) throw fail('Flight status provider is unavailable. Try again shortly.', 502);

  const data = await res.json().catch(() => null);
  const flight = data?.flights?.[0];
  if (!flight) throw fail('Flight not found', 404);

  return {
    ident: flight.ident || ident,
    operator: flight.operator || '',
    status: flight.status || '',
    origin: flight.origin?.code_iata || flight.origin?.code || '',
    destination: flight.destination?.code_iata || flight.destination?.code || '',
    scheduledOut: flight.scheduled_out || null,
    estimatedOut: flight.estimated_out || null,
    scheduledIn: flight.scheduled_in || null,
    estimatedIn: flight.estimated_in || null,
    actualIn: flight.actual_in || null,
    gateOrigin: flight.gate_origin || null,
    gateDestination: flight.gate_destination || null,
    terminalOrigin: flight.terminal_origin || null,
    terminalDestination: flight.terminal_destination || null,
    cancelled: Boolean(flight.cancelled),
    diverted: Boolean(flight.diverted),
  };
};
