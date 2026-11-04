import { useCrmRides, useCrmDrivers, useDispatchMutate } from '../../hooks/useCrmQuery';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { useState } from 'react';
import { vehicleLabel } from '../../../../data/vehicles.js';

const COLS: { id:string; label:string; statuses:string[] }[] = [
  { id:'pending', label:'Pending / Scheduled', statuses:['pending','scheduled'] },
  { id:'assigned', label:'Assigned', statuses:['accepted','arriving'] },
  { id:'active', label:'In Progress', statuses:['in_progress'] },
  { id:'done', label:'Completed', statuses:['completed','cancelled','no_show','refunded'] },
];

export default function DispatchBoard() {
  const { data } = useCrmRides({}) as any;
  const { data: driverData } = useCrmDrivers() as any;
  const rides: any[] = data?.rides ?? [];
  const drivers: any[] = driverData?.drivers ?? [];
  const { mutate, isPending, error } = useDispatchMutate() as any;
  const [selected, setSelected] = useState<Record<string,string>>({});

  const approved = drivers.filter((d) => d.isApproved && !d.isSuspended);
  const assign = (ride:any) => {
    const driverId = selected[ride._id];
    if (driverId) mutate({ id: ride._id, driverId });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Dispatch Center</h1>
        <span className="text-sm text-muted">Assign approved, vehicle-matched chauffeurs • Live via Socket.io</span>
      </div>
      {error && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error?.response?.data?.message || 'Assignment failed'}</p>}
      <div className="grid gap-4 lg:grid-cols-4">
        {COLS.map(col => (
          <Card key={col.id} className="min-h-[420px] p-0">
            <div className="sticky top-0 rounded-t-2xl border-b bg-accent-50 px-4 py-3 dark:border-accent-800 dark:bg-accent-800/50">
              <h3 className="text-sm font-semibold">
                {col.label} <span className="ml-2 text-xs font-normal text-muted">{rides.filter(r=>col.statuses.includes(r.status)).length}</span>
              </h3>
            </div>
            <div className="space-y-3 p-3">
              {rides.filter(r=>col.statuses.includes(r.status)).slice(0,20).map(r=> {
                const eligible = approved.filter((d) => d.driverDetails?.vehicleType === r.vehicleType);
                return (
                  <div key={r._id} className="rounded-xl border bg-surface p-3 shadow-sm dark:border-accent-700 dark:bg-accent-900">
                    <div className="flex items-center justify-between">
                      <Badge tone={r.status==='pending'?'slate':r.status==='completed'?'green':'brand'}>{r.status}</Badge>
                      <span className="text-xs text-muted">${(r.fare?.estimated ?? 0).toFixed(2)}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{r.passenger?.name || '—'}</p>
                    <p className="truncate text-xs text-muted">{r.pickup?.address} → {r.dropoff?.address}</p>
                    <p className="text-xs text-muted">
                      {vehicleLabel(r.vehicleType)} • {r.scheduledAt ? new Date(r.scheduledAt).toLocaleString() : 'ASAP'}
                    </p>
                    <p className="text-xs text-muted">{r.driver ? `Chauffeur: ${r.driver.name}` : 'Unassigned'}</p>

                    {['pending','scheduled'].includes(r.status) && (
                      <div className="mt-2 space-y-1.5">
                        <select
                          value={selected[r._id] || ''}
                          onChange={(e) => setSelected((s) => ({ ...s, [r._id]: e.target.value }))}
                          className="w-full rounded-full border border-accent-200 bg-white px-3 py-1.5 text-xs dark:border-white/10 dark:bg-transparent"
                          aria-label={`Assign driver to ride ${r._id}`}
                        >
                          <option value="">Choose chauffeur…</option>
                          {eligible.map((d) => (
                            <option key={d._id} value={d._id}>
                              {d.name} — {vehicleLabel(d.driverDetails?.vehicleType)} {d.driverDetails?.plateNumber ? `(${d.driverDetails.plateNumber})` : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => assign(r)}
                          disabled={!selected[r._id] || isPending}
                          className="w-full rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          {isPending ? 'Assigning…' : 'Assign chauffeur'}
                        </button>
                        {eligible.length === 0 && <p className="text-xs text-amber-700">No approved {vehicleLabel(r.vehicleType)} chauffeur available.</p>}
                      </div>
                    )}

                    {r.driver && ['accepted','arriving'].includes(r.status) && (
                      <button
                        onClick={() => mutate({ id: r._id, driverId: null })}
                        disabled={isPending}
                        className="mt-2 w-full rounded-full border border-accent-200 px-3 py-1.5 text-xs font-semibold hover:bg-accent-50 disabled:opacity-50 dark:border-white/10"
                      >
                        Unassign
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
