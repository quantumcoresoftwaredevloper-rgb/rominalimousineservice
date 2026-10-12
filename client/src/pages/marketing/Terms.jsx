import PageHero from '../../components/marketing/PageHero.jsx';
import { PHONE_TEL, PHONE_DISPLAY, EMAIL } from '../../data/site.js';

const UPDATED = '12 October 2026';

const SECTIONS = [
  {
    id: 'booking',
    title: 'Booking and service',
    body: [
      `A booking is a request for a private chauffeur service. We assign a vehicle appropriate to the number of passengers and luggage you select. If we cannot serve a request we will tell you before the trip, and you are not charged for a trip we do not perform.`,
      'Fares are quoted before you book and are based on distance, estimated time and vehicle class. Toll charges, if any, are passed through at cost.',
      'You may change or cancel a booking from your account while it is still pending. Once a driver has accepted and is en route, cancellation terms below apply.',
    ],
  },
  {
    id: 'payment',
    title: 'Payment',
    body: [
      'You can pay by card at the time of booking, or choose cash and pay your driver directly at the end of the trip.',
      'Card payments are processed by our payment provider. We never store your full card number.',
      'A booking is confirmed once payment is authorised, or once the driver has accepted a cash booking.',
      'If a card payment is declined the booking is not confirmed and you will be told before the trip.',
    ],
  },
  {
    id: 'cancellation',
    title: 'Cancellation and refunds',
    body: [
      'Free cancellation up to 2 hours before the scheduled pickup time. Cancel from your account, or call us.',
      'Within 2 hours of pickup, or after a driver has arrived, a cancellation fee of 50% of the quoted fare applies, because the vehicle has been held.',
      'No-show — a driver arriving at a pickup point and being unable to contact you — is charged in full.',
      'If we cancel for any reason on our side, you are refunded in full. This is not conditional on anything.',
      'Refunds are returned to the original payment method. Allow 5–10 business days for your bank to post them.',
      'A driver arriving more than 15 minutes after the agreed pickup time entitles you to a 15% discount on the fare, applied without you having to ask.',
    ],
  },
  {
    id: 'delays',
    title: 'Delays and wait times',
    body: [
      'Delays are common at airports. Our fixed airport rates include waiting time at the terminal.',
      'If a delay is caused by the driver and exceeds 30 minutes, the wait time is deducted from your fare.',
      'Delays outside our control — traffic, weather, flight delays, or a passenger elsewhere on the route — are not chargeable to you.',
    ],
  },
  {
    id: 'luggage',
    title: 'Passengers and luggage',
    body: [
      'Please tell us the number of passengers and bags when booking. A sedan carries up to 4 passengers and 3 bags; larger vehicles carry more.',
      'If you travel with more passengers or luggage than you selected, we may not be able to carry it safely, and you may need to book a larger vehicle.',
      'Child seats are not provided by default. Tell us in advance and we will do what we can.',
    ],
  },
  {
    id: 'conduct',
    title: 'Conduct',
    body: [
      'We do not discriminate on the basis of race, colour, religion, sex, sexual orientation, gender identity, national origin or disability.',
      'Abusive, threatening or discriminatory behaviour towards a driver or towards staff will end the trip without refund.',
      'Smoking in the vehicle is not permitted.',
    ],
  },
  {
    id: 'liability',
    title: 'Liability',
    body: [
      'Our vehicles are commercially insured. Cover and limits are set by our insurer, not by these terms.',
      'Please keep valuables with you. We are not liable for items left in a vehicle; tell us promptly if you believe something has been left behind and we will try to recover it.',
      'Nothing in these terms limits liability that cannot lawfully be limited.',
    ],
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: [
      'We may update these terms. The version in effect when you book is the version that applies to that booking.',
      'Material changes will be announced on this page with a new date.',
    ],
  },
  {
    id: 'contact',
    title: 'Contact',
    body: [`Questions about a booking, a charge or these terms: ${EMAIL} or ${PHONE_DISPLAY}.`],
  },
];

export default function Terms() {
  return (
    <>
      <PageHero
        eyebrow="Terms"
        title="Terms of Service"
        subtitle="The agreement between you and Romina Limousine Service when you book a trip."
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted">Last updated {UPDATED}.</p>

        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-brand-200 bg-brand-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">On this page</p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-brand-700 underline-offset-2 hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 space-y-9">
          {SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="font-display text-xl font-bold text-ink">{s.title}</h2>
              <div className="mt-3 space-y-3">
                {s.body.map((p) => (
                  <p key={p.slice(0, 40)} className="text-[15px] leading-relaxed text-ink/80">{p}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-display text-lg font-bold text-ink">Before you go live</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            The cancellation windows, fees and discount percentages above are reasonable defaults,
            not your actual policy — they are placeholders where your real commercial terms go.
            Confirm them with whoever insures and operates the fleet, then edit this page to match.
            Add your legal entity name and registered address at the top; Google requires both before
            it will verify this app.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={`mailto:${EMAIL}`} className="btn-brand-gradient px-5 py-2.5 text-sm font-semibold">
              Ask a question
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