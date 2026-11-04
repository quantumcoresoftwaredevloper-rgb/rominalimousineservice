import { Card, CardTitle } from '../../components/ui/card';
import { SkeletonCard } from '../../../crm/components/ui/skeleton';
import { DollarSign, TrendingUp, CreditCard, Banknote, AlertCircle, Clock } from 'lucide-react';
import { useDriverStats } from '../../hooks/useDriverQuery';

export default function EarningsPage(){
  const { data: s, isLoading, isError, refetch } = useDriverStats() as any;
  if(isLoading) return <div className="grid gap-4 sm:grid-cols-4">{Array.from({length:4}).map((_,i)=><SkeletonCard key={i} />)}</div>;
  if(isError) return <Card className="text-center py-12"><AlertCircle className="h-10 w-10 mx-auto text-amber-500" /><p className="mt-2 font-medium">Could not load earnings</p><button onClick={()=>refetch()} className="mt-3 rounded-full btn-brand-gradient px-5 py-2 text-sm text-white">Retry</button></Card>;

  const stats = s?.stats;
  const cards = [
    { label:"Today", value: stats ? `$${stats.todayEarnings.toFixed(2)}` : '—', sub: `${stats?.todayTrips ?? 0} completed`, icon:DollarSign },
    { label:"Last 7 days", value: stats ? `$${stats.weekEarnings.toFixed(2)}` : '—', sub: `${stats?.weekTrips ?? 0} completed`, icon:TrendingUp },
    { label:"Last 30 days", value: stats ? `$${stats.monthEarnings.toFixed(2)}` : '—', sub: `${stats?.monthTrips ?? 0} completed`, icon:TrendingUp },
    { label:"Lifetime fares", value: stats ? `$${stats.totalFares.toFixed(2)}` : '—', sub: `${stats?.completedRides ?? 0} completed`, icon:Banknote },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Earnings</h1>
      <div className="grid gap-4 sm:grid-cols-4">
        {cards.map(c=> <Card key={c.label}><div className="flex items-center gap-2"><c.icon className="h-4 w-4 text-brand-600" /><p className="text-xs uppercase tracking-widest text-muted">{c.label}</p></div><p className="font-display mt-2 text-2xl font-bold dark:text-white">{c.value}</p><p className="text-xs text-muted">{c.sub}</p></Card>)}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Settlement — cash vs card</CardTitle>
          <p className="mt-1 text-xs text-muted">Card fares are processed automatically. Cash is recorded when you confirm collection.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-accent-50 p-4 dark:bg-white/5"><p className="text-xs text-muted">Cash collected</p><p className="font-bold dark:text-white">${(stats?.cashCollected ?? 0).toFixed(2)}</p></div>
            <div className="rounded-2xl bg-brand-50 p-4 text-brand-700 dark:bg-brand-950"><p className="text-xs text-muted">Card collected</p><p className="font-bold">${(stats?.cardCollected ?? 0).toFixed(2)}</p></div>
            <div className="rounded-2xl bg-gold-50 p-4 text-gold-700"><p className="text-xs text-muted">Cash due</p><p className="font-bold">${(stats?.cashDue ?? 0).toFixed(2)}</p></div>
            <div className="rounded-2xl bg-green-50 p-4 text-green-700"><p className="text-xs text-muted">Total collected</p><p className="font-bold">${(stats?.collected ?? 0).toFixed(2)}</p></div>
          </div>
        </Card>
        <Card>
          <CardTitle>Last 7 days</CardTitle>
          {stats?.daily?.some((d:any)=>d.earnings>0) ? (
            <ul className="mt-3 space-y-2 text-sm">
              {stats.daily.map((d:any)=>(
                <li key={d.date} className="flex items-center justify-between rounded-2xl border border-accent-200 p-3 dark:border-white/5">
                  <span>{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}</span>
                  <span className="text-muted">{d.trips} trips</span>
                  <span className="font-semibold text-brand-700">${d.earnings.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-sm text-muted"><Clock className="mr-1 inline h-4 w-4" /> No completed fares in the last 7 days.</p>}
        </Card>
      </div>
    </div>
  );
}
