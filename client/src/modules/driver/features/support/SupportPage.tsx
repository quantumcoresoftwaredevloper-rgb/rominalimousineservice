import { Card, CardTitle } from '../../components/ui/card';
import { Phone, Mail, MessageCircle } from 'lucide-react';
import { PHONE_TEL, PHONE_DISPLAY, EMAIL, WHATSAPP } from '../../../../data/site.js';

export default function SupportPage(){
  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold dark:text-white">Support</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Contact dispatch</CardTitle>
          <p className="mt-2 text-sm text-muted">Use these live channels. In-app live chat is not configured.</p>
          <div className="mt-4 space-y-2">
            <a href={PHONE_TEL} className="flex min-h-11 items-center gap-2 rounded-2xl bg-brand-600 p-4 text-white hover:bg-brand-700"><Phone className="h-4 w-4" /><span className="font-semibold">Call {PHONE_DISPLAY}</span></a>
            <a href={WHATSAPP} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-2xl border border-accent-200 p-4 font-semibold hover:bg-accent-50 dark:border-white/10"><MessageCircle className="h-4 w-4 text-brand-600" /> WhatsApp dispatch</a>
            <a href={`mailto:${EMAIL}`} className="flex min-h-11 items-center gap-2 rounded-2xl border border-accent-200 p-4 font-semibold hover:bg-accent-50 dark:border-white/10"><Mail className="h-4 w-4 text-brand-600" /> {EMAIL}</a>
          </div>
        </Card>
        <Card>
          <CardTitle>Operational questions</CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="rounded-2xl bg-accent-50 p-3 dark:bg-white/5"><p className="font-medium dark:text-white">Cash fares</p><p className="text-xs text-muted">Mark cash collected from Trip History after the passenger hands it over.</p></li>
            <li className="rounded-2xl bg-accent-50 p-3 dark:bg-white/5"><p className="font-medium dark:text-white">Scheduled pickups</p><p className="text-xs text-muted">Assigned reservations appear in Upcoming and activate 30 minutes before pickup.</p></li>
            <li className="rounded-2xl bg-accent-50 p-3 dark:bg-white/5"><p className="font-medium dark:text-white">Payouts</p><p className="text-xs text-muted">No automated payout account is connected; settlement is handled by dispatch.</p></li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
