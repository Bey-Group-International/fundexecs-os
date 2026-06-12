import type { FormationData, FormationKind } from './config';

/**
 * lib/formation/compose.ts — drafted-document composer (pure).
 *
 * Renders the substance of each formed document from the operator's
 * decisions: the full drafted-document view behind the checklist's Review
 * rows and the Complete screen. These are **illustrative working drafts**,
 * never legal instruments — every composed doc carries the disclaimer and
 * the view badges it `Illustrative`. No React, no IO.
 */

export interface FormationDocSection {
  heading: string;
  /** Prose paragraphs. */
  paras: string[];
  /** Term-sheet style labeled rows. */
  rows: [string, string][];
}

export interface FormationDoc {
  kind: FormationKind;
  /** Document name, e.g. "Limited Partnership Agreement". */
  title: string;
  /** One-line classification under the title. */
  lede: string;
  sections: FormationDocSection[];
  disclaimer: string;
}

export const FORMATION_DOC_DISCLAIMER =
  'Illustrative working draft — Earn drafted this from your formation decisions. It is not a ' +
  'legal instrument: nothing reaches an LP or a regulator until your counsel reviews and you sign.';

function sec(
  heading: string,
  rows: [string, string][] = [],
  paras: string[] = []
): FormationDocSection {
  return { heading, paras, rows };
}

const NOT_WRITTEN = 'Not yet written — reopen this step to draft it with Earn.';

/**
 * Render a composed doc as plain text — the immutable body stored per filing
 * in `capital_material_versions`, so every amendment leaves a readable
 * snapshot behind. Markdown-ish: title, lede, sections, rows as label lines.
 */
export function renderFormationDoc(doc: FormationDoc): string {
  const lines: string[] = [`# ${doc.title}`, doc.lede, ''];
  for (const s of doc.sections) {
    lines.push(`## ${s.heading}`);
    for (const [k, v] of s.rows) lines.push(`- ${k}: ${v}`);
    for (const p of s.paras) lines.push(p);
    lines.push('');
  }
  lines.push(`> ${doc.disclaimer}`);
  return lines.join('\n');
}

const inc = (on: boolean) => (on ? 'Included' : 'Omitted');
const sift = (v: string) => (v.startsWith('Not sure') ? 'Earn decides — flagged for review' : v);

/** Compose one formed document's substance from the working decisions. */
export function composeFormationDoc(
  kind: FormationKind,
  d: FormationData,
  ctx: { firm: string }
): FormationDoc {
  const firm = ctx.firm || 'Your fund';
  const entity = d.entity === 'Undecided' ? 'Delaware LP (Earn standard)' : d.entity;
  const entityPlain = d.entity === 'Undecided' ? 'Delaware LP' : d.entity;
  const exemption = d.exemption === 'Undecided' ? 'Rule 506(b) (Earn standard)' : d.exemption;
  const isB = d.exemption !== '506(c)';

  const base = { kind, disclaimer: FORMATION_DOC_DISCLAIMER };

  if (kind === 'story') {
    return {
      ...base,
      title: 'Fund narrative',
      lede: `The through-line ${firm}'s deck, PPM and LP conversations inherit`,
      sections: [
        sec('Positioning', [], [d.storyHook || NOT_WRITTEN]),
        sec('Origin — why you, why this', [], [d.storyOrigin || NOT_WRITTEN]),
        sec(
          'Your edge',
          d.storyEdges.map((e) => ['Edge', e]),
          d.storyEdges.length ? [] : [NOT_WRITTEN]
        ),
        sec('Why now', [], [d.storyWhyNow || NOT_WRITTEN]),
        sec(
          'Where this narrative travels',
          [],
          [
            'Every later document inherits this story: the PPM opens with the positioning, the ' +
              'deck leads with the edge, and LP conversations return to the origin. Change it here ' +
              'and Earn re-threads it everywhere.'
          ]
        )
      ]
    };
  }

  if (kind === 'structure') {
    return {
      ...base,
      title: 'Certificate of Formation',
      lede: `The legal body that holds ${firm}'s capital`,
      sections: [
        sec('The entity', [
          ['Fund entity', entity],
          ['Domicile', d.domicile],
          ['General partner', d.gp],
          ['Management company', d.mgmtco]
        ]),
        sec(
          'Formation',
          [],
          [
            `${firm} is organized as a ${entityPlain} under the laws of ${d.domicile}. ` +
              `${d.gp} serves as its general partner and carries the management of the partnership; ` +
              `${d.mgmtco} provides investment-management services under a separate management agreement.`,
            'Name reservation, registered-agent designation and the certificate itself are prepared ' +
              'for counsel review before anything is filed with the state.'
          ]
        )
      ]
    };
  }

  if (kind === 'terms') {
    const basis: [string, string][] = d.termsUndecided
      ? [['Basis', 'Market standard (set by Earn) — adjust any term to make it yours']]
      : [];
    return {
      ...base,
      title: 'Limited Partnership Agreement',
      lede: `The economics and governance between you and ${firm}'s LPs`,
      sections: [
        sec('Economic terms', [
          ['Management fee', `${d.fee}% per annum on committed capital`],
          ['Carried interest', `${d.carry}% above the preferred return`],
          ['Preferred return', `${d.hurdle}% compounded annually`],
          ['GP commitment', `${d.gpCommit}% of total commitments`],
          ['Fund term', `${d.term} years, plus customary 1-year extensions`],
          ...basis
        ]),
        sec(
          'Distribution waterfall',
          [],
          [
            `Distributions return contributed capital first, then the ${d.hurdle}% preferred ` +
              `return to LPs, then a GP catch-up, then ${100 - d.carry}/${d.carry} between LPs and ` +
              'the GP. The waterfall is drafted whole-fund (European), the institutional default ' +
              'for an emerging manager.'
          ]
        ),
        sec(
          'Governance',
          [],
          [
            'Customary LP protections — key-person provisions, for-cause GP removal, and LP ' +
              'advisory committee consent rights over conflicts — are drafted to institutional ' +
              'standard for counsel review.'
          ]
        )
      ]
    };
  }

  if (kind === 'ppm') {
    return {
      ...base,
      title: 'Private Placement Memorandum',
      lede: `How ${firm}'s opportunity, terms and risks are presented to investors`,
      sections: [
        sec('Offering summary', [
          ['Offering exemption', exemption],
          ['Minimum commitment', sift(d.minCommit)],
          ['Fund term', `${d.term} years`]
        ]),
        sec('Contents', [
          ['Track record', inc(d.ppmTrack)],
          ['Worked fee example', inc(d.ppmFee)],
          ['Conflicts of interest disclosure', inc(d.ppmConflicts)],
          ['Sector-specific risk factors', inc(d.ppmSector)]
        ]),
        sec(
          'Risk factors',
          [],
          [
            'Standard institutional risk factors — illiquidity, concentration, reliance on key ' +
              'personnel, and no assurance of returns — are drafted in full.' +
              (d.ppmSector
                ? ' Sector-specific risks tailored to your thesis are layered on top.'
                : ' Sector-specific risks are omitted at your direction.')
          ]
        )
      ]
    };
  }

  if (kind === 'subscription') {
    return {
      ...base,
      title: 'Subscription pack',
      lede: `How an LP formally comes into ${firm}`,
      sections: [
        sec('Subscription terms', [
          ['Minimum commitment', sift(d.minCommit)],
          ['Accreditation', sift(d.accredMethod)],
          ['Side letters', d.sideLetters ? 'Allowed for anchor LPs' : 'Not allowed']
        ]),
        sec(
          'How an LP commits',
          [],
          [
            'The pack bundles the subscription agreement, the investor questionnaire and the ' +
              'accreditation certification. An LP completes eligibility, signs the subscription ' +
              'agreement, and the GP countersigns to admit them at the next closing.' +
              (d.sideLetters
                ? ' Side letters are negotiated separately and disclosed to the LPAC.'
                : '')
          ]
        )
      ]
    };
  }

  if (kind === 'regulatory') {
    return {
      ...base,
      title: 'Form D',
      lede: `${firm}'s regulatory green light to accept capital`,
      sections: [
        sec('Exemption', [
          ['Exemption', exemption],
          ['Investor eligibility', sift(d.accred)],
          ['ERISA tracking', d.erisa ? 'On — 25% benefit-plan limit monitored' : 'Off']
        ]),
        sec(
          'Filing',
          [],
          [
            'Form D is prepared for filing with the SEC within 15 days of the first sale, with ' +
              'state blue-sky notices to follow where LPs subscribe.',
            isB
              ? 'Under Rule 506(b) there is no general solicitation: every LP must come through a ' +
                'pre-existing relationship and self-certify accreditation.'
              : 'Under Rule 506(c) you may market publicly, but every LP must be verified ' +
                'accredited by a third party before closing.'
          ]
        )
      ]
    };
  }

  // bank
  return {
    ...base,
    title: 'Bank & escrow accounts',
    lede: `Where ${firm}'s committed capital lands`,
    sections: [
      sec('Accounts', [
        ['Fund bank', sift(d.bank)],
        ['Escrow agent', sift(d.escrow)],
        ['Account setup', d.acctType]
      ]),
      sec(
        'Capital flow',
        [],
        [
          d.acctType === 'Operating only'
            ? 'LP capital arrives into the operating account directly; Earn recommends adding a ' +
              'dedicated capital-call account before the first close.'
            : 'Capital calls land in the dedicated capital-call account, clear escrow at each ' +
              'closing, and sweep to the operating account as the fund deploys.'
        ]
      )
    ]
  };
}
