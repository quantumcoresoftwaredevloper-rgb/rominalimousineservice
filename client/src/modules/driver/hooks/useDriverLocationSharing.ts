import { useEffect, useRef, useState } from 'react';
import { emitDriverLocation } from '../../../services/socketService.js';

/**
 * Continuously watches the driver's position while they are on duty (or on an
 * active trip) and publishes it over the socket. The server persists each
 * sample, so nearby-driver searches and live tracking stay accurate even when
 * the driver is not sitting on the dashboard page.
 */
export default function useDriverLocationSharing(enabled: boolean) {
  const latest = useRef<{ lat: number; lng: number } | null>(null);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return undefined;
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported in this browser');
      return undefined;
    }

    let watchId: number | null = null;
    const startWatch = () => {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          latest.current = next;
          setPosition(next);
          setError('');
        },
        (err) => setError(err.message || 'Location permission denied'),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    };

    startWatch();
    // Emit on a fixed cadence rather than per GPS sample: it survives a socket
    // reconnect and keeps traffic bounded at 1 update / 2 s.
    const timer = window.setInterval(() => {
      const p = latest.current;
      if (p) emitDriverLocation(p.lat, p.lng, 0, 0);
    }, 2000);

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { position, error };
}
