import PageHero from '../../components/marketing/PageHero.jsx';
import { BRAND_NAME, PHONE_TEL, PHONE_DISPLAY, EMAIL } from '../../data/site.js';

const UPDATED = '12 October 2026';

const SECTIONS = [
  {
    id: 'what-we-collect',
    title: 'What we collect',
    body: [
      'When you create an account or book a ride we collect your name, email address, phone number, the pickup and drop-off details of your trip, the vehicle you choose, how many passengers and bags are travelling, and the payments you make.',
      'If you register as a driver we additionally hold your vehicle type, plate number and licence number, your live location while you are on duty, and your rating history.',
      'Our web server keeps standard technical logs — IP address, browser, pages visited and timestamps — for security and troubleshooting. These are retained for a short period and then discarded.',
    ],
  },
  {
    id: 'how-we-use-it',
    title: 'How we use it',
    body: [
      'To match you with a driver, route your trip, calculate and take your fare, and send you updates about your booking.',
      'To contact you about a ride in progress, a driver en route, or a problem with your booking.',
      'To send your booking confirmation, your receipt, and — where you have asked for it — service messages. We do not send marketing email unless you have opted in.',
      'To detect fraud and abuse, such as accounts registered on someone else’s address or attempts to book without paying.',
    ],
  },
  {
    id: 'location',
    title: 'Location data',
    body: [
      'Your phone’s location is used while a trip is active so your driver can find you and so you can watch them approach. It is shared with the driver assigned to your trip and is not shared with any third party.',
      'Drivers broadcast their location while on duty so passengers can see nearby cars. Once off duty, broadcasting stops.',
      'We do not build a permanent history of your movements. Trip pickup and drop-off coordinates are retained as part of your booking record.',
    ],
  },
  {
    id: 'sharing',
    title: 'Who we share it with',
    body: [
      'With the driver assigned to your specific trip — your name, phone number and pickup point, so they can reach you.',
      'With payment processors, to take and refund your payment. Card details are handled by the processor; we never see or store your full card number.',
      'With our email and hosting providers, who process data on our instructions to run the service.',
      'With law enforcement where we are legally required to do so.',
      'We do not sell personal information and we do not share it with advertisers.',
    ],
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    body: [
      'We store your session in your browser’s local storage so you stay signed in. This is not a tracking cookie — it never leaves your device and we cannot read it.',
      'We do not run advertising trackers, analytics beacons or third-party marketing pixels on this site.',
      'Map tiles are served by OpenStreetMap, and fonts by Google Fonts; those providers will see your IP address as a normal consequence of serving those files.',
    ],
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: [
      'Booking records and receipts are kept for as long as we may need them for accounting, dispute and legal purposes.',
      'Closed driver accounts and their location history are removed once they are no longer required.',
      'You can ask us to delete your account at any time by emailing us. We will remove what we are not legally required to retain.',
    ],
  },
  {
    id: 'security',
    title: 'How we protect it',
    body: [
      'Passwords are stored only as one-way hashes — nobody, including us, can read them.',
      'Traffic is encrypted with HTTPS.',
      'Access to personal information is limited to staff who need it to operate the service.',
      'No system is perfect. If a breach affects your information we will tell you and the relevant authority as required by law.',
    ],
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: [
      'You may ask what personal information we hold about you, ask for a copy of it, ask us to correct anything wrong, or ask us to delete it.',
      'Email us and we will respond within a reasonable time. We may need to verify your identity before releasing information.',
    ],
  },
  {
    id: 'children',
    title: 'Children',
    body: [
      'This service is not for anyone under 18. We do not knowingly collect information from children.',
    ],
  },
  {
    id: 'contact-us',
    title: 'Contact',
    body: [
      `Questions about this policy: ${BRAND_NAME}, by email ${EMAIL} or phone ${PHONE_DISPLAY}.`,
    ],
  },
];

export default function Privacy() {
  return (
    <>
      <PageHero
        eyebrow="Privacy"
        title="Privacy Policy"
        subtitle="What we collect, why we collect it, and what we will never do with it."
      />

      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted">
          Last updated {UPDATED}. This policy explains how {BRAND_NAME} handles personal information
          when you use our website, book a ride, or drive for us.
        </p>

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

        <div className="mt-12 rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="font-display text-lg font-bold text-ink">Fill this in before you go live</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/80">
            This policy is written to be accurate as written, but it names only the details we know.
            Add your legal entity name and registered business address at the top, and confirm that
            Maryland or local law does not require anything further. A privacy policy that omits your
            business address is the single most common reason Google refuses to verify an app.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={`mailto:${EMAIL}`} className="btn-brand-gradient px-5 py-2.5 text-sm font-semibold">
              Ask a question
            </a>
            <a href={PHONE_TEL} className="rounded-full border border-brand-300 px-5 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
              {PHONE_DISPLAY}
            </a>
          </div>
        </div>
      </div>
    </>
  );
}