import type { Metadata } from 'next';
import { SubmitDealForm } from './SubmitDealForm';

export const metadata: Metadata = {
  title: 'Submit Your Deal · FundExecs OS',
  description:
    'Share your raise with FundExecs OS GPs. Fill out the form and a curated GP will review your submission.'
};

export default function SubmitPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <div className="mb-10">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(91,141,239,0.3)] bg-[rgba(91,141,239,0.08)] px-3 py-1 text-[11.5px] font-medium text-[#5b8def]">
          Deal Submission
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
          Submit your raise
        </h1>
        <p className="mt-2 text-sm text-[#94a3b8]">
          GPs on FundExecs OS review every submission. If there&apos;s a fit, you&apos;ll hear back
          within 5 business days.
        </p>
      </div>
      <SubmitDealForm />
    </main>
  );
}
