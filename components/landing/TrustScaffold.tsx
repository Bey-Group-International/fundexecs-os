import { ShieldCheck, Users } from 'lucide-react';

/* ============================================================================
 * TrustScaffold — pre-built, EMPTY-BY-DEFAULT trust slots for the landing
 * page, rendered just above the footer once content exists.
 *
 * Nothing here may be guessed or assumed. Fill the constants below ONLY with
 * verified facts:
 *
 * TODO(team): SECURITY_LINE — a one-line security/compliance statement (data
 *   handling, SOC 2 status, data residency). Must be verified with whoever
 *   owns compliance before it ships; an unverified claim on a finance site is
 *   a liability, so the section renders nothing until this is set.
 *
 * TODO(team): FOUNDER_LINE — founder/team identity ("Built by …"), with
 *   names/affiliations the team has approved for public use.
 * ========================================================================= */

const SECURITY_LINE: string | null = null;
const FOUNDER_LINE: string | null = null;

export function TrustScaffold() {
  if (!SECURITY_LINE && !FOUNDER_LINE) return null;

  return (
    <section className="border-t border-hairline bg-bg-1 py-10" aria-label="Security and team">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-center sm:gap-10 sm:px-8">
        {SECURITY_LINE && (
          <p className="flex items-center gap-2.5 text-[12.5px] leading-6 text-fg-3">
            <ShieldCheck
              size={16}
              strokeWidth={1.9}
              className="flex-none text-gold-1"
              aria-hidden
            />
            {SECURITY_LINE}
          </p>
        )}
        {FOUNDER_LINE && (
          <p className="flex items-center gap-2.5 text-[12.5px] leading-6 text-fg-3">
            <Users size={16} strokeWidth={1.9} className="flex-none text-gold-1" aria-hidden />
            {FOUNDER_LINE}
          </p>
        )}
      </div>
    </section>
  );
}

export default TrustScaffold;
