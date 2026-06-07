import type { Metadata } from 'next';
import { LegalShell, LegalHeading } from '@/components/legal/LegalShell';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How FundExecs OS collects, uses, and protects your information.'
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="June 6, 2026">
      <p>
        FundExecs OS (&ldquo;FundExecs&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) is operated by
        Bey Group International. This policy explains what we collect, how we use it, and the
        choices you have. FundExecs OS is currently offered as an invite-only private beta.
      </p>

      <div className="space-y-3">
        <LegalHeading>Information we collect</LegalHeading>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account information</strong> — your name, email, organization, and role,
            provided at sign-up or through Google sign-in.
          </li>
          <li>
            <strong>Workspace content</strong> — the deals, contacts, relationships, governance
            plans, documents, and Chain-of-Trust records you create in the product.
          </li>
          <li>
            <strong>Connected services</strong> — if you choose to connect an integration (e.g.
            Google Workspace), we access only the data covered by the read-only scopes you grant, to
            provide the features you request. You can disconnect at any time.
          </li>
          <li>
            <strong>Billing information</strong> — if you purchase AI credits, Stripe processes your
            payment on our behalf. We receive only a confirmation and the credit amount; full card
            details are never stored by FundExecs.
          </li>
          <li>
            <strong>Usage data</strong> — standard logs and device/browser metadata used to operate
            and secure the service.
          </li>
        </ul>
      </div>

      <div className="space-y-3">
        <LegalHeading>How we use information</LegalHeading>
        <p>
          We use your information to provide and improve the product, personalize your workspace,
          power AI assistance (&ldquo;Earn&rdquo;), process credit purchases, maintain security, and
          communicate with you about the service. We do not sell your personal information.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Service providers</LegalHeading>
        <p>
          We rely on a small set of trusted processors to run FundExecs OS: Supabase
          (authentication, database, storage), Vercel (hosting), Anthropic (AI assistance), Voyage
          AI (embeddings for retrieval), and Stripe (payment processing for credit top-ups). Each
          processes data only to provide its function. Integration data stays within your workspace.
          Stripe processes payment information directly and is subject to its own privacy policy;
          FundExecs does not store full card details.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Google user data</LegalHeading>
        <p>
          If you connect Google, FundExecs&rsquo; use of information received from Google APIs
          adheres to the{' '}
          <a
            className="text-azure-1 underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. We request read-only scopes, use the data solely
          to deliver the connected features, never use it for advertising, and never sell it.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Data security &amp; retention</LegalHeading>
        <p>
          Access is enforced with row-level security so your data is scoped to your organization.
          Secrets and access tokens are stored server-side and never exposed to the browser. We
          retain your data for as long as your account is active; you may request deletion at any
          time.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Your choices</LegalHeading>
        <p>
          You can access and update your profile in Settings, disconnect integrations, and request
          export or deletion of your data by contacting us.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Contact</LegalHeading>
        <p>
          Questions about this policy? Email{' '}
          <a className="text-azure-1 underline" href="mailto:privacy@fundexecs.com">
            privacy@fundexecs.com
          </a>
          .
        </p>
      </div>
    </LegalShell>
  );
}
