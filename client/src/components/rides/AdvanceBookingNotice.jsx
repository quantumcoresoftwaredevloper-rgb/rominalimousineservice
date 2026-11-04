import { Clock, Phone } from 'lucide-react';
import { PHONE_DISPLAY, PHONE_TEL } from '../../data/site.js';

/**
 * Shared notice for the company's 2-hour advance-booking recommendation.
 * This is informational only — it never blocks or alters a reservation.
 */
export default function AdvanceBookingNotice({ className = '' }) {
  return (
    <aside
      role="note"
      aria-label="Advance booking notice"
      className={`rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:p-5 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-brand-700 ring-1 ring-brand-200">
          <Clock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-brand-900">Advance Booking Notice</p>
          <p className="mt-1.5 text-sm leading-relaxed text-brand-950/75">
            Please book your limousine at least 2 hours before your scheduled pickup time to allow
            us to arrange your chauffeur and vehicle.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-brand-950/75">
            Need transportation sooner? Contact our team directly to check availability.
          </p>
          <a
            href={PHONE_TEL}
            className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm font-semibold text-brand-700 ring-1 ring-brand-200 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            Call {PHONE_DISPLAY}
          </a>
        </div>
      </div>
    </aside>
  );
}
