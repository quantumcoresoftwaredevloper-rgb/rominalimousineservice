import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Card, CardTitle } from '../../components/ui/card';
import { LocateFixed, Crosshair } from 'lucide-react';
import useGeolocation from '../../../../hooks/useGeolocation.js';
import { UBER_SEDAN } from '../../../../components/maps/pinIcons.js';
import { useEffect } from 'react';
import { useDriverProfile, useDriverRides } from '../../hooks/useDriverQuery';

const driverIcon = L.divIcon({ className:'', html:`<div style="filter: drop-shadow(0 3px 8px rgba(0,0,0,0.32));">${UBER_SEDAN}</div>`, iconSize:[32,32], iconAnchor:[16,16] });

function FollowControl({ position, onRecenter }:{position:any, onRecenter:()=>void}){
  const map = useMap();
  useEffect(()=>{ if(position) map.flyTo([position.lat, position.lng], 14, {animate:true, duration:1}); },[position?.lat, position?.lng]);
  return <button onClick={onRecenter} className="absolute bottom-4 right-4 z-[1000] grid h-11 w-11 place-items-center rounded-full bg-white shadow-lg ring-1 ring-accent-200 hover:bg-accent-50 dark:bg-accent-900 dark:ring-white/10" aria-label="Recenter map"><Crosshair className="h-5 w-5 text-ink dark:text-white" /></button>;
}

export default function MapPage(){
  const { position, locate } = useGeolocation();
  const { data: profile } = useDriverProfile() as any;
  const { data: ridesData } = useDriverRides() as any;
  const available = !!profile?.user?.driverDetails?.isAvailable;
  const hasActive = (ridesData?.rides ?? []).some((r:any) => ['accepted','arriving','in_progress'].includes(r.status));
  const sharing = available || hasActive;
  const center = (position ? [position.lat, position.lng] : [39.207, -76.857]) as [number,number];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Your Location</h1>
      <Card className="p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent-200 p-4 dark:border-white/5">
          <div className="flex items-center gap-2"><LocateFixed className="h-4 w-4 text-brand-600" /><CardTitle>Live Map</CardTitle></div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${sharing ? 'bg-green-50 text-green-700' : 'bg-accent-100 text-muted'}`}>
              <span className={`h-2 w-2 rounded-full ${sharing ? 'animate-pulse bg-green-500' : 'bg-accent-400'}`} />
              {sharing ? 'Sharing live' : 'Not sharing'}
            </span>
            <button onClick={locate} className="rounded-full border border-accent-200 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-accent-50 dark:border-white/10 dark:bg-transparent">Refresh</button>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-b-3xl">
          <MapContainer center={center} zoom={14} style={{height:'520px', width:'100%'}} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
            <Marker position={center} icon={driverIcon}>
              <Popup><b>You</b><br/>{position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Location unavailable'}<br/><span className="text-xs text-muted">{sharing ? 'Visible to dispatch and passengers on your active trip' : 'Go on duty to share your location'}</span></Popup>
            </Marker>
            <FollowControl position={position} onRecenter={locate} />
          </MapContainer>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 bg-accent-50 px-4 py-2 text-xs dark:bg-white/5">
          <span className="text-muted">{position ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}` : 'Locating…'}</span>
          <span className="font-medium text-brand-700">{sharing ? 'Location sharing on' : 'Go on duty in the sidebar to share your location'}</span>
        </div>
      </Card>
    </div>
  );
}
