import PageHero from '../../components/marketing/PageHero.jsx';
import { BRAND_NAME, PHONE_TEL, PHONE_DISPLAY, EMAIL } from '../../data/site.js';

const UPDATED = '12 October 2026';

const ROWS = [
  { when: 'More than 2 hours before pickup', refund: 'Full refund', note: 'Cancel from your account or call us.' },
  { when: 'Within 2 hours of pickup', refund: '50% of the quoted fare', note: 'The vehicle has already been held.' },
  { when: 'Driver en route or arrived', refund: '50% of the quoted fare', note: 'Applies from the moment the driver accepts.' },
  { when: 'No-show', refund: 'No refund', note: 'Driver arrived and could not reach you.' },
  { when: 'We cancel', refund: '100% refund', note: 'No conditions, no exceptions.' },
  { when: 'Driver 15+ min late, no cause from you', refund: '15% off the fare', note: 'Applied automatically — you do not need to ask.' },
  { when: 'Driver 30+ min late, our fault', refund: 'Wait time deducted', note: 'Time waited is removed from your fare.' },
];

export default function RefundPolicy() {
  return (
    <>
      <PageHero
        eyebrow="Refunds"
        title="Cancellation & Refund Policy"
        subtitle="Plain terms. If we cancel, you are refunded in full, without conditions."
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted">Last updated {UPDATED}.</p>

        <div className="mt-8 overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs uppercase tracking-widest text-muted">
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Refund</th>
                <th className="px-4 py-3 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.when} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3 font-medium text-ink">{r.when}</td>
                  <td className="px-4 py-3 text-brand-700">{r.refund}</td>
                  <td className="px-4 py-3 text-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-10 space-y-6 text-[15px] leading-relaxed text-ink/80">
          <section>
            <h2 className="font-display text-lg font-bold text-ink">How refunds are paid</h2>
            <p className="mt-2">
              Refunds go back to the original payment method. Your bank or card issuer typically
              takes 5–10 business days to post the credit after we release it. Cash bookings paid
              to a driver are refunded by us to the original card, not handed back at the kerb.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-ink">How to request one</h2>
            <p className="mt-2">
              Cancel from your account while the booking is still pending, or email
              {' '}
              <a href={`mailto:${EMAIL}`} className="text-brand-700 underline">{EMAIL}</a>
              {' '}with your booking reference. For anything time-sensitive, call{' '}
              <a href={PHONE_TEL} className="text-brand-700 underline">{PHONE_DISPLAY}</a>.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-ink">Disputes</h2>
            <p className="mt-2">
              If a charge looks wrong, tell us within 30 days and we will investigate and correct
              it. We would always rather fix a billing problem than defend it.
            </p>
          </section>
        </div>

        <div className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-display text-lg font-bold text-ink">Before you go live</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            These windows and percentages are a reasonable starting point, not your commercial
            policy. Replace them with the terms your operator and insurer actually work to, then edit
            this page to match. Keeping a promise here that dispatch cannot honour is how a refund
            policy becomes a complaints page.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={`mailto:${EMAIL}`} className="btn-brand-gradient px-5 py-2.5 text-sm font-semibold">
              {BRAND_NAME}
            </a>
            <a
              href={PHONE_TEL}
              className="rounded-full border border-brand-300 px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              {PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}