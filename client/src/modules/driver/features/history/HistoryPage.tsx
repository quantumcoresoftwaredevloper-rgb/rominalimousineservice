import { Card, CardTitle } from '../../components/ui/card';
import { SkeletonCard } from '../../../crm/components/ui/skeleton';
import { Search, Calendar, AlertCircle, Star, Banknote } from 'lucide-react';
import { useDriverRides } from '../../hooks/useDriverQuery';
import { useState } from 'react';
import { collectCashForRide } from '../../../../services/paymentService.js';

const FILTERS = ['All','Today','This Week','Completed','Cancelled','Upcoming'] as const;

const paymentLabel = (payment:any) => {
  switch (payment?.status) {
    case 'paid': return payment.method === 'cash' ? 'Cash paid' : 'Card paid';
    case 'cash_due': return 'Cash due';
    case 'cash_collected': return 'Cash paid';
    case 'refunded': return 'Refunded';
    default: return 'Unpaid';
  }
};

export default function HistoryPage(){
  const { data, isLoading, isError, refetch } = useDriverRides() as any;
  const [f,setF]=useState('All');
  const [q,setQ]=useState('');
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');

  if(isLoading) return <div className="grid gap-4">{Array.from({length:3}).map((_,i)=><SkeletonCard key={i} />)}</div>;
  if(isError) return <Card className="text-center py-12"><AlertCircle className="h-10 w-10 mx-auto text-amber-500" /><p className="mt-2 font-medium">Could not load history</p><button onClick={()=>refetch()} className="mt-3 rounded-full btn-brand-gradient px-5 py-2 text-sm text-white">Retry</button></Card>;

  const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
  let rides:any[] = data?.rides ?? [];
  if(f==='Completed') rides=rides.filter((r:any)=>r.status==='completed');
  if(f==='Cancelled') rides=rides.filter((r:any)=>r.status==='cancelled');
  if(f==='Upcoming') rides=rides.filter((r:any)=>['scheduled','accepted','arriving','in_progress'].includes(r.status));
  if(f==='Today') rides=rides.filter((r:any)=> new Date(r.scheduledAt || r.createdAt) >= startOfToday);
  if(f==='This Week') rides=rides.filter((r:any)=> new Date(r.scheduledAt || r.createdAt) >= weekAgo);
  if(q) rides=rides.filter((r:any)=> `${r.pickup.address} ${r.dropoff.address}`.toLowerCase().includes(q.toLowerCase()));

  const collect = async (rideId:string) => {
    setBusy(rideId); setError('');
    try {
      await collectCashForRide(rideId);
      await refetch();
    } catch (err:any) {
      setError(err.response?.data?.message || 'Could not record cash collection');
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Trip History</h1>
      {error && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <Card className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pickup/dropoff…" className="input-pill w-full border border-accent-200 bg-white pl-10 pr-4 py-2.5 text-sm focus:border-brand-500 dark:border-white/10 dark:bg-transparent" />
        </div>
        {FILTERS.map(x=><button key={x} onClick={()=>setF(x)} className={`min-h-11 rounded-full px-4 py-2 text-xs font-semibold ${f===x?'bg-brand-700 text-white':'bg-accent-50 text-muted hover:bg-accent-100 dark:bg-white/5'}`}>{x}</button>)}
      </Card>
      {rides.length ? (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-accent-50 text-xs uppercase tracking-widest text-muted dark:bg-white/5">
                <tr><th className="px-4 py-3">Trip</th><th className="px-4 py-3">Route</th><th className="px-4 py-3">Fare</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Rating</th></tr>
              </thead>
              <tbody className="divide-y divide-accent-100 dark:divide-white/5">
                {rides.slice(0,50).map((r:any)=>(
                  <tr key={r._id} className="hover:bg-accent-50/50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-xs text-muted">{new Date(r.scheduledAt || r.createdAt).toLocaleDateString()} • {r.fare.distanceKm}km</td>
                    <td className="max-w-[280px] truncate px-4 py-3 dark:text-white">{r.pickup.address.slice(0,32)} → {r.dropoff.address.slice(0,22)}</td>
                    <td className="px-4 py-3 font-semibold dark:text-white">${(r.fare.final ?? r.fare.estimated).toFixed(2)}</td>
                    <td className="px-4 py-3"><span className="rounded-full bg-accent-100 px-2.5 py-1 text-xs capitalize dark:bg-white/10">{r.status.replace('_',' ')}</span></td>
                    <td className="px-4 py-3 text-xs">
                      <span className={`rounded-full px-2.5 py-1 font-medium ${r.payment?.status==='cash_due'?'bg-gold-100 text-gold-700':['paid','cash_collected'].includes(r.payment?.status)?'bg-green-50 text-green-700':'bg-accent-100 text-muted dark:bg-white/10'}`}>
                        {paymentLabel(r.payment)}
                      </span>
                      {r.payment?.status === 'cash_due' && (
                        <button onClick={()=>collect(r._id)} disabled={busy===r._id} className="ml-2 inline-flex items-center gap-1 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
                          <Banknote className="h-3 w-3" />{busy===r._id?'Saving…':'Mark collected'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{r.rating?.score ? <span className="inline-flex items-center gap-1"><Star className="h-3 w-3 fill-current text-gold-400" />{r.rating.score}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : <Card className="text-center py-12"><Calendar className="h-12 w-12 mx-auto text-accent-300" /><p className="mt-3 font-medium dark:text-white">No trips match this filter</p><p className="text-sm text-muted">Complete your first ride to see history, receipts and ratings</p></Card>}
    </div>
  );
}
