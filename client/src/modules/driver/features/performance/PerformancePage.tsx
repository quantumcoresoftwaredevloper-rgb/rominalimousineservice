import { Card, CardTitle } from '../../components/ui/card';
import { CheckCircle, Star, Car, Clock, AlertCircle } from 'lucide-react';
import { useDriverStats } from '../../hooks/useDriverQuery';

export default function PerformancePage(){
  const { data, isLoading, isError } = useDriverStats() as any;
  const stats = data?.stats;
  if(isError) return <Card className="text-center py-12"><AlertCircle className="h-10 w-10 mx-auto text-amber-500" /><p className="mt-2 font-medium">Could not load performance</p></Card>;

  const metrics = [
    { k:'Completed trips', v: stats?.completedRides ?? '—', d:`${stats?.totalRides ?? 0} total assigned`, icon: CheckCircle },
    { k:'Rating', v: stats?.rating ? stats.rating.toFixed(2) : '—', d:`${stats?.ratingCount ?? 0} passenger reviews`, icon: Star },
    { k:'Scheduled assignments', v: stats?.scheduledRides ?? '—', d:'Upcoming reservations', icon: Clock },
    { k:'Cash due', v: stats ? `$${stats.cashDue.toFixed(2)}` : '—', d:'Uncollected cash fares', icon: Car },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Performance</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        {metrics.map(s=> <Card key={s.k}><div className="flex items-center gap-2"><s.icon className="h-4 w-4 text-brand-600" /><p className="text-xs uppercase tracking-widest text-muted">{s.k}</p></div><p className="font-display mt-2 text-2xl font-bold dark:text-white">{s.v}</p><p className="text-xs text-muted">{s.d}</p></Card>)}
      </div>
      <Card>
        <CardTitle>Metrics not yet tracked</CardTitle>
        <p className="mt-2 text-sm text-muted">
          Acceptance rate, cancellation rate, response time and on-time percentage are not
          recorded by this platform yet, so they are intentionally not displayed rather than
          estimated.
        </p>
        <p className="mt-2 text-xs text-muted">Loading state: {isLoading ? 'loading…' : 'loaded'}</p>
      </Card>
    </div>
  );
}
