import { Card, CardTitle } from '../../components/ui/card';
import { Star, ThumbsUp, AlertCircle } from 'lucide-react';
import { useDriverStats, useDriverRides } from '../../hooks/useDriverQuery';

const COMPLIMENT_LABELS: Record<string,string> = {
  clean: 'Clean vehicle',
  professional: 'Professional',
  friendly: 'Friendly',
  safe: 'Safe driving',
};

export default function RatingsPage(){
  const { data: statsData, isLoading, isError } = useDriverStats() as any;
  const { data: ridesData } = useDriverRides() as any;
  const stats = statsData?.stats;
  const reviews = ((ridesData?.rides ?? []) as any[])
    .filter((r) => r.rating?.score)
    .sort((a,b)=> new Date(b.rating.createdAt || b.updatedAt).getTime() - new Date(a.rating.createdAt || a.updatedAt).getTime())
    .slice(0,10);

  if(isError) return <Card className="text-center py-12"><AlertCircle className="h-10 w-10 mx-auto text-amber-500" /><p className="mt-2 font-medium">Could not load ratings</p></Card>;

  const compliments = Object.entries(stats?.compliments || {}).filter(([,v]) => Number(v) > 0);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Ratings & Reviews</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="text-center">
          <p className="text-xs uppercase tracking-widest text-muted">Overall rating</p>
          <p className="font-display mt-2 flex items-center justify-center gap-2 text-4xl font-bold dark:text-white">
            <Star className="h-7 w-7 fill-current text-gold-400" />
            {isLoading ? '—' : stats?.rating ? stats.rating.toFixed(2) : '—'}
          </p>
          <p className="text-xs text-muted">{stats?.ratingCount ?? 0} reviews</p>
        </Card>
        <Card>
          <CardTitle>Compliments</CardTitle>
          {compliments.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {compliments.map(([key, value]) => (
                <li key={key} className="flex items-center justify-between rounded-2xl bg-accent-50 p-3 dark:bg-white/5">
                  <span className="flex items-center gap-2"><ThumbsUp className="h-4 w-4 text-brand-600" />{COMPLIMENT_LABELS[key] || key}</span>
                  <span className="font-bold text-brand-700">{String(value)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">No compliments recorded yet.</p>}
        </Card>
        <Card>
          <CardTitle>Review coverage</CardTitle>
          <p className="mt-2 text-sm text-muted">
            {stats?.completedRides
              ? `${stats.ratingCount} of ${stats.completedRides} completed trips have a rating.`
              : 'Complete a trip to receive a rating.'}
          </p>
        </Card>
      </div>
      <Card>
        <CardTitle>Recent reviews</CardTitle>
        {reviews.length ? (
          <ul className="mt-3 space-y-3">
            {reviews.map((r) => (
              <li key={r._id} className="rounded-2xl border border-accent-200 p-4 dark:border-white/5">
                <div className="flex items-center gap-2 text-gold-400">
                  {Array.from({length:r.rating.score}).map((_,i)=><Star key={i} className="h-4 w-4 fill-current" />)}
                  <span className="ml-2 text-xs text-muted">
                    {r.rating.createdAt ? new Date(r.rating.createdAt).toLocaleDateString() : ''}
                  </span>
                </div>
                {r.rating.comment && <p className="mt-2 text-sm dark:text-white">“{r.rating.comment}”</p>}
                {r.rating.compliments?.length > 0 && <p className="mt-1 text-xs text-muted">{r.rating.compliments.map((c:string)=>COMPLIMENT_LABELS[c]||c).join(' • ')}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-muted">No passenger reviews yet.</p>}
      </Card>
    </div>
  );
}
