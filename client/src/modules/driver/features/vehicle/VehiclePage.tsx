import { Card } from '../../components/ui/card';
import { useDriverProfile } from '../../hooks/useDriverQuery';
import { vehicleLabel } from '../../../../data/vehicles.js';

const imageFor = (vehicleType?: string) =>
  vehicleType === 'Chevrolet' ? '/images/chevrolet.jpg' : '/images/premium-suv.jpg';

export default function VehiclePage(){
  const { data } = useDriverProfile() as any;
  const d = data?.user?.driverDetails || {};
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl font-bold dark:text-white">Vehicle</h1>
      <Card className="flex gap-6 flex-wrap">
        <img src={imageFor(d.vehicleType)} alt={vehicleLabel(d.vehicleType)} className="h-32 w-48 rounded-2xl object-cover border border-accent-200" />
        <div>
          <p className="font-display font-bold">{vehicleLabel(d.vehicleType)} • {d.plateNumber || 'Plate not recorded'}</p>
          <p className="text-sm text-muted">{d.vehicleName || 'Vehicle model not recorded'}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <span className="rounded-full bg-accent-50 px-2.5 py-1 dark:bg-white/5">Licence {d.licenseNo || 'not recorded'}</span>
            <span className={`rounded-full px-2.5 py-1 ${d.isAvailable ? 'bg-green-50 text-green-700' : 'bg-accent-50 text-muted dark:bg-white/5'}`}>{d.isAvailable ? 'On duty' : 'Off duty'}</span>
          </div>
          <p className="mt-3 text-xs text-muted">
            Inspection, insurance and service dates are not stored by this platform. Contact dispatch to update them.
          </p>
        </div>
      </Card>
    </div>
  );
}
