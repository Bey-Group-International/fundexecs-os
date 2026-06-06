import type { Metadata } from 'next';
import { LegalShell, LegalHeading } from '@/components/legal/LegalShell';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms governing your use of FundExecs OS.'
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="June 6, 2026">
      <p>
        These Terms govern your access to and use of FundExecs OS, operated by FundExecs
        Technologies. By creating an account or using the service, you agree to these Terms. If you
        are using FundExecs OS on behalf of an organization, you represent that you are authorized
        to accept these Terms for that organization.
      </p>

      <div className="space-y-3">
        <LegalHeading>Beta service</LegalHeading>
        <p>
          FundExecs OS is provided as an invite-only private beta. Features may change, and the
          service is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis while
          in beta.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Accounts</LegalHeading>
        <p>
          You are responsible for safeguarding your account credentials and for all activity under
          your account. Notify us promptly of any unauthorized use.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Acceptable use</LegalHeading>
        <p>
          You agree not to misuse the service: no unlawful activity, no attempts to breach security
          or access data you are not authorized to view, no reverse engineering, and no uploading of
          content you do not have the right to use.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Your content</LegalHeading>
        <p>
          You retain ownership of the content you submit. You grant us a limited license to host and
          process that content solely to operate and improve the service for you. You are
          responsible for the content you upload and for having the rights to connect any
          third-party data.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Intellectual property</LegalHeading>
        <p>
          FundExecs OS, including its software, design, and the &ldquo;Earn&rdquo; AI experience, is
          owned by FundExecs Technologies and protected by applicable law. These Terms grant you no
          rights to our trademarks or branding.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Disclaimers &amp; limitation of liability</LegalHeading>
        <p>
          AI-generated output may be inaccurate and should not be treated as financial, legal, or
          investment advice; verify before relying on it. To the maximum extent permitted by law,
          the service is provided without warranties, and FundExecs Technologies is not liable for
          indirect, incidental, or consequential damages arising from your use of the service.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Termination</LegalHeading>
        <p>
          You may stop using the service at any time. We may suspend or terminate access that
          violates these Terms or to protect the service and its users.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Changes</LegalHeading>
        <p>
          We may update these Terms as the product evolves. Material changes will be reflected by
          the &ldquo;Last updated&rdquo; date above, and continued use constitutes acceptance.
        </p>
      </div>

      <div className="space-y-3">
        <LegalHeading>Contact</LegalHeading>
        <p>
          Questions about these Terms? Email{' '}
          <a className="text-azure-1 underline" href="mailto:legal@fundexecs.com">
            legal@fundexecs.com
          </a>
          .
        </p>
      </div>
    </LegalShell>
  );
}
