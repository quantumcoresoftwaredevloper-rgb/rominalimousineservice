import { Card, CardTitle } from '../../components/ui/card';
import { SkeletonCard } from '../../../crm/components/ui/skeleton';
import { Wallet, CreditCard, Banknote, AlertCircle } from 'lucide-react';
import { useDriverStats } from '../../hooks/useDriverQuery';

export default function WalletPage(){
  const { data, isLoading, isError, refetch } = useDriverStats() as any;
  if(isLoading) return <div className="grid gap-4 sm:grid-cols-3">{Array.from({length:3}).map((_,i)=><SkeletonCard key={i} />)}</div>;
  if(isError) return <Card className="text-center py-12"><AlertCircle className="h-12 w-12 mx-auto text-amber-500" /><p className="mt-3 font-medium">Could not load settlement data</p><button onClick={()=>refetch()} className="mt-3 rounded-full btn-brand-gradient px-5 py-2 text-sm text-white">Retry</button></Card>;
  const stats = data?.stats;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Settlement</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-brand-600" /><p className="text-xs uppercase tracking-widest text-muted">Collected</p></div>
          <p className="font-display mt-2 text-3xl font-bold dark:text-white">${(stats?.collected ?? 0).toFixed(2)}</p>
          <p className="mt-1 text-xs text-muted">Card + collected cash on completed trips</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-muted">Cash due</p>
          <p className="font-display mt-2 text-2xl font-bold dark:text-white">${(stats?.cashDue ?? 0).toFixed(2)}</p>
          <p className="text-xs text-muted">Confirm collection from the ride history</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-widest text-muted">Payout account</p>
          <p className="mt-2 text-sm text-muted">No bank account or stored payout balance is connected to this platform.</p>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-accent-50 px-2.5 py-1 text-xs text-muted dark:bg-white/5">Not configured</span>
        </Card>
      </div>
      <Card>
        <CardTitle>How settlement works</CardTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-accent-200 p-4 dark:border-white/5">
            <p className="flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-brand-600" /> Card fares</p>
            <p className="mt-1 text-xs text-muted">Collected online via Stripe and recorded automatically.</p>
            <p className="mt-2 font-semibold text-brand-700">${(stats?.cardCollected ?? 0).toFixed(2)}</p>
          </div>
          <div className="rounded-2xl border border-accent-200 p-4 dark:border-white/5">
            <p className="flex items-center gap-2 text-sm font-semibold"><Banknote className="h-4 w-4 text-brand-600" /> Cash fares</p>
            <p className="mt-1 text-xs text-muted">Marked due at trip end, then confirmed collected by you.</p>
            <p className="mt-2 font-semibold text-brand-700">${(stats?.cashCollected ?? 0).toFixed(2)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
