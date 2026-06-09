'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Zap
} from 'lucide-react';
import { Badge, Button, Card, Input, ProgressBar, Select } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { OnboardingStepper, type OnboardingStep } from '@/components/onboarding/OnboardingStepper';
import { CelebrationToast, type Celebration } from '@/components/dashboard/CelebrationToast';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import { getQuestionSet, type ProfileQuestion } from '@/lib/proof-of-truth/questions';
import type { ProfileRecommendation } from '@/lib/proof-of-truth/earn-profile';
import type { MemberProfile } from '@/lib/queries/member-profile';
import { awardTrustXp } from '@/lib/actions/xp';
import {
  saveMemberDraft,
  saveMemberProfile,
  setMemberType as setMemberTypeAction
} from '@/lib/actions/member-profile';
import { SetPasswordForm } from '@/components/account/SetPasswordForm';
import { getMyReferralLink } from '@/lib/actions/referral-code';

/** Where each member type goes first after onboarding — carries momentum into
 *  one concrete action instead of dropping them on a cold dashboard. */
const FIRST_ACTION: Record<MemberType, { label: string; href: string }> = {
  investment_firm: { label: 'Add your first LP', href: '/pipeline' },
  individual_investor: { label: 'Build your watchlist', href: '/pipeline' },
  startup: { label: 'Prep your materials', href: '/materials' },
  service_provider: { label: 'See your matches', href: '/partners' },
  student: { label: 'Open your command center', href: '/command-center' }
};
import {
  answersToProfileInput,
  completionPct,
  computeLadder,
  nextGapIndex,
  seedAnswers,
  splitTags,
  type Answers
} from './profile-mapping';
import { ProfileLadder } from '@/components/profile/ProfileLadder';
import { MemberTypePicker } from './MemberTypePicker';
import { LiveProfilePanel } from './LiveProfilePanel';
import { Recommendations } from './Recommendations';
import { TagInput } from './TagInput';

interface ProofOfTruthFlowProps {
  /** Seeded from `getMemberProfile()` on the server. */
  profile: MemberProfile;
  /** Where to go on Finish. */
  redirectTo?: string;
  /** Optional question id to start on (Profile "close gap" deep-link). */
  focusField?: string;
  /** Onboarding only: offer a "Secure your account" (set password) card on the
   *  completion screen, so a new member leaves with a durable way back in. */
  offerPassword?: boolean;
  /** The member's email, shown on the secure-account card. */
  email?: string;
  /** Onboarding only: surface the member's referral link on the completion
   *  screen, so the compounding loop starts the moment they finish. */
  showReferralNudge?: boolean;
}

type Stage = 'picker' | 'qa' | 'review' | 'done';

/** Earn's recommendation state for the current question. */
interface RecState {
  /** True once the member has asked Earn for this question. */
  requested: boolean;
  loading: boolean;
  degraded: boolean;
  insight: string;
  options: ProfileRecommendation[];
}

const IDLE_REC: RecState = {
  requested: false,
  loading: false,
  degraded: false,
  insight: '',
  options: []
};

export function ProofOfTruthFlow({
  profile,
  redirectTo = '/command-center',
  focusField,
  offerPassword = false,
  email,
  showReferralNudge = false
}: ProofOfTruthFlowProps) {
  const router = useRouter();

  const [memberType, setMemberType] = useState<MemberType | null>(profile.memberType);
  // `answers` holds ONLY approved values (the profile derives from this).
  const [answers, setAnswers] = useState<Answers>(() => seedAnswers(profile));
  const [stage, setStage] = useState<Stage>(profile.memberType ? 'qa' : 'picker');
  // Start on the focused question when a "close gap" deep-link points at one
  // (only meaningful once a member type is set, so the question set exists).
  const [index, setIndex] = useState(() => {
    if (!profile.memberType || !focusField) return 0;
    const i = getQuestionSet(profile.memberType).findIndex((q) => q.id === focusField);
    return i >= 0 ? i : 0;
  });
  const [pickerBusy, setPickerBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Completion reward — XP total returned by awardTrustXp + the celebration toast.
  const [awardedXp, setAwardedXp] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  // Referral nudge (onboarding finish): the member's personal link + a copied flag.
  const [referralUrl, setReferralUrl] = useState<string | null>(null);
  const [refCopied, setRefCopied] = useState(false);

  // Per-question Earn recommendation state, keyed by question id.
  const [recByQuestion, setRecByQuestion] = useState<Record<string, RecState>>({});
  // Per-question disliked values (what the member passed on), keyed by question id.
  const [dislikedByQuestion, setDislikedByQuestion] = useState<Record<string, string[]>>({});
  // Per-question typed-input drafts (not yet approved), keyed by question id.
  const [typedByQuestion, setTypedByQuestion] = useState<Record<string, string>>({});

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);
  // Token guards against a stale fetch resolving onto the wrong question.
  const requestToken = useRef(0);
  // Latest answers, readable inside async continuations without re-creating the
  // fetch callback on every keystroke. Synced in an effect (never during render).
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);
  // Mirror of typed-but-unapproved drafts, so the autosave + commit can merge
  // them without re-creating callbacks on every keystroke.
  const typedRef = useRef(typedByQuestion);
  useEffect(() => {
    typedRef.current = typedByQuestion;
  }, [typedByQuestion]);

  // Keystroke-level autosave: debounce-persist typed-but-unapproved text into the
  // resumable draft, so a crash / logout / accidental close mid-sentence never
  // costs the member their words. Approved answers take precedence over a typed
  // draft for the same question. No-op until they've actually typed something.
  useEffect(() => {
    if (Object.keys(typedByQuestion).length === 0) return;
    const id = window.setTimeout(() => {
      void saveMemberDraft({ ...typedRef.current, ...answersRef.current });
    }, 800);
    return () => window.clearTimeout(id);
  }, [typedByQuestion]);

  // Fetch the member's referral link once they reach the finish screen, so the
  // compounding loop can start immediately. Best-effort; the card is hidden on miss.
  useEffect(() => {
    if (stage !== 'done' || !showReferralNudge) return;
    let active = true;
    getMyReferralLink()
      .then((res) => {
        if (active && res.ok) setReferralUrl(res.url);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [stage, showReferralNudge]);

  async function copyReferral() {
    if (!referralUrl) return;
    try {
      await navigator.clipboard.writeText(referralUrl);
      setRefCopied(true);
      window.setTimeout(() => setRefCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context) — the field is selectable.
    }
  }

  const questions = memberType ? getQuestionSet(memberType) : [];
  const question: ProfileQuestion | undefined = questions[index];

  const rec = question ? (recByQuestion[question.id] ?? IDLE_REC) : IDLE_REC;
  const approvedValue = question ? (answers[question.id] ?? '') : '';
  // The typed draft falls back to the approved value so re-opening an answered
  // question (Back nav / resumed draft) shows it, and so it stays editable.
  const typedValue = question
    ? Object.prototype.hasOwnProperty.call(typedByQuestion, question.id)
      ? typedByQuestion[question.id]
      : approvedValue
    : '';
  const isApproved = question
    ? Object.prototype.hasOwnProperty.call(answers, question.id) && approvedValue.trim().length > 0
    : false;

  // --- answer helpers ---

  /** Commit an APPROVED value into answers + save the resumable draft. */
  const commitAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: value };
      // Fire-and-forget draft save so the flow is resumable. Merge in the typed
      // drafts of OTHER questions so approving one never drops another's
      // in-progress text (approved values win for their own question).
      void saveMemberDraft({ ...typedRef.current, ...next });
      return next;
    });
  }, []);

  const setTyped = useCallback((id: string, value: string) => {
    setTypedByQuestion((prev) => ({ ...prev, [id]: value }));
  }, []);

  // --- Earn recommendation fetch (setState only in async continuations) ---

  const fetchRecommendations = useCallback(
    (q: ProfileQuestion, type: MemberType, avoid: string[]) => {
      const token = ++requestToken.current;
      setRecByQuestion((prev) => ({
        ...prev,
        [q.id]: { requested: true, loading: true, degraded: false, insight: '', options: [] }
      }));

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14_000);

      fetch('/api/earn/profile-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberType: type,
          questionId: q.id,
          answers: answersRef.current,
          disliked: avoid
        }),
        signal: controller.signal
      })
        .then((res) => (res.ok ? res.json() : { ok: false, degraded: true }))
        .then(
          (data: {
            ok?: boolean;
            degraded?: boolean;
            insight?: string;
            options?: ProfileRecommendation[];
          }) => {
            if (token !== requestToken.current) return; // superseded
            if (data?.ok && Array.isArray(data.options) && data.options.length > 0) {
              setRecByQuestion((prev) => ({
                ...prev,
                [q.id]: {
                  requested: true,
                  loading: false,
                  degraded: false,
                  insight: data.insight ?? '',
                  options: data.options ?? []
                }
              }));
            } else {
              setRecByQuestion((prev) => ({
                ...prev,
                [q.id]: {
                  requested: true,
                  loading: false,
                  degraded: true,
                  insight: '',
                  options: []
                }
              }));
            }
          }
        )
        .catch(() => {
          if (token !== requestToken.current) return;
          // Error / timeout → degrade to manual entry. Never block.
          setRecByQuestion((prev) => ({
            ...prev,
            [q.id]: { requested: true, loading: false, degraded: true, insight: '', options: [] }
          }));
        })
        .finally(() => clearTimeout(timer));
    },
    []
  );

  // Do NOT auto-fetch on entering a question. The member triggers Earn via the
  // Recommend button. On unmount/question-change, invalidate any in-flight fetch.
  useEffect(() => {
    const tokenRef = requestToken;
    return () => {
      tokenRef.current++;
    };
  }, [index, memberType]);

  // --- recommendation actions ---

  function requestRecommendations() {
    if (!question || !memberType) return;
    fetchRecommendations(question, memberType, dislikedByQuestion[question.id] ?? []);
  }

  function approveValue(value: string) {
    if (!question) return;
    commitAnswer(question.id, value);
  }

  function dislikeOption(value: string) {
    if (!question) return;
    const qid = question.id;
    setDislikedByQuestion((prev) => {
      const list = prev[qid] ?? [];
      if (list.some((v) => v === value)) return prev;
      return { ...prev, [qid]: [...list, value] };
    });
    // Drop the disliked option from the visible set.
    setRecByQuestion((prev) => {
      const cur = prev[qid];
      if (!cur) return prev;
      return { ...prev, [qid]: { ...cur, options: cur.options.filter((o) => o.value !== value) } };
    });
  }

  function regenerate() {
    if (!question || !memberType) return;
    // Pass everything passed on so far (including currently-visible) is handled
    // by the disliked list already recorded; send that to Earn to avoid.
    fetchRecommendations(question, memberType, dislikedByQuestion[question.id] ?? []);
  }

  // --- picker ---

  async function pickType(type: MemberType) {
    setError(null);
    setPickerBusy(true);
    const res = await setMemberTypeAction(type);
    setPickerBusy(false);
    if (!res.ok) {
      setError(res.error ?? 'Could not set your member type. Please try again.');
      return;
    }
    setMemberType(type);
    setIndex(0);
    setStage('qa');
  }

  // --- navigation ---

  function goNext() {
    if (index < questions.length - 1) {
      setIndex((i) => i + 1);
    } else {
      setStage('review');
    }
  }

  function goBack() {
    if (index > 0) setIndex((i) => i - 1);
    else setStage('picker');
  }

  function focusInput() {
    inputRef.current?.focus();
  }

  // --- finish ---

  async function finish() {
    if (!memberType) return;
    setSubmitting(true);
    setError(null);
    const res = await saveMemberProfile(answersToProfileInput(memberType, answers));
    if (!res.ok) {
      setError(res.error ?? 'Could not save your profile. Please try again.');
      setSubmitting(false);
      return;
    }
    // Reward the completed Proof-of-Truth layer (idempotent per user server-side;
    // returns the new XP total). Best-effort — never blocks the finish.
    const xp = await awardTrustXp({
      layer: 'truth',
      entityType: 'member_profile',
      entityId: profile.userId || 'member_profile'
    }).catch(() => null);
    setAwardedXp(xp);
    setCelebration({
      kind: 'badge',
      title: 'Profile verified',
      detail: 'Proof of Truth complete — Earn built your verified profile.'
    });
    // No auto-redirect: the completion screen lets the operator choose where to go.
    setStage('done');
  }

  const pct = memberType ? completionPct(memberType, answers) : 0;

  // --- render: done ---

  if (stage === 'done' && memberType) {
    const nextAction = FIRST_ACTION[memberType];
    return (
      <Shell step="done">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <Card className="overflow-hidden p-0">
            {/* Celebration header */}
            <div className="flex flex-col items-center gap-3 bg-[linear-gradient(105deg,rgba(247,201,72,0.14),rgba(247,201,72,0.02)_46%,transparent_72%)] px-6 py-8 text-center">
              <EarnCoin size={56} glow online className="flex-none" />
              <div className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">
                Your profile is verified 🎉
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Badge tone="gold" className="gap-1 px-2.5 py-1 text-[11.5px]">
                  <Zap size={13} strokeWidth={2.2} aria-hidden />
                  Proof of Truth complete
                </Badge>
                {awardedXp != null ? (
                  <Badge tone="gold" className="px-2.5 py-1 text-[11.5px] tabular-nums">
                    {awardedXp.toLocaleString()} XP
                  </Badge>
                ) : null}
              </div>
            </div>

            {/* What Earn set up */}
            <div className="border-t border-hairline px-5 py-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[12.5px] font-semibold text-fg-1">What Earn set up</div>
                <span className="text-[11px] tabular-nums text-fg-4">{pct}% complete</span>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-1">
                {questions.map((q) => {
                  const value = answers[q.id] ?? '';
                  const display = q.kind === 'tags' ? splitTags(value).join(', ') : value.trim();
                  if (!display) return null;
                  return (
                    <div
                      key={q.id}
                      className="flex items-start justify-between gap-4 border-b border-hairline py-2 last:border-0"
                    >
                      <span className="flex-none text-[11.5px] text-fg-4">{q.label}</span>
                      <span className="min-w-0 break-words text-right text-[12px] font-medium text-fg-1">
                        {display}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Secure your account — set a password so a logout/expired link
                  never costs them their progress. Optional; the actions below
                  stay available either way. Onboarding-only (offerPassword). */}
              {offerPassword && (
                <div className="mt-5 rounded-xl border border-[var(--azure-line)] bg-[var(--azure-soft)] p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-1">
                    <ShieldCheck size={15} strokeWidth={2} aria-hidden className="text-azure-1" />
                    Secure your account
                  </div>
                  <p className="mt-1 mb-3 text-[11.5px] leading-relaxed text-fg-4">
                    Set a password
                    {email ? (
                      <>
                        {' '}
                        for <span className="font-medium text-fg-2">{email}</span>
                      </>
                    ) : null}{' '}
                    so you can always sign back in and pick up where you left off — even if you get
                    logged out. Optional; you can also do this later in Settings.
                  </p>
                  <SetPasswordForm submitLabel="Set password" />
                </div>
              )}

              {/* Referral nudge — start the compounding loop the moment they
                  finish: their link earns 10% of referred purchases (5% a level
                  deeper). Onboarding-only; hidden until the link resolves. */}
              {showReferralNudge && referralUrl && (
                <div className="mt-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-fg-1">
                    <Sparkles size={15} strokeWidth={2} aria-hidden className="text-gold-1" />
                    Start earning — share your link
                  </div>
                  <p className="mt-1 mb-3 text-[11.5px] leading-relaxed text-fg-4">
                    Invite a peer and earn <span className="font-medium text-fg-2">10%</span> of the
                    Earn credits they buy — plus 5% from the people they bring. It compounds.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={referralUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full truncate rounded-lg border border-hairline bg-surface-1 px-3 py-2 font-mono text-[11.5px] text-fg-2 outline-none"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      icon={refCopied ? Check : Copy}
                      onClick={copyReferral}
                    >
                      {refCopied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </div>
              )}

              {/* First-action nudge — carry momentum into one concrete step. */}
              <div className="mt-5 flex flex-col gap-2">
                <Button
                  variant="primary"
                  iconRight={ArrowUpRight}
                  onClick={() => router.push(nextAction.href)}
                >
                  {nextAction.label}
                </Button>
                <Button variant="ghost" onClick={() => router.push(redirectTo)}>
                  Go to your command center
                </Button>
              </div>
            </div>
          </Card>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <LiveProfilePanel memberType={memberType} answers={answers} />
          </div>
        </div>
        <CelebrationToast celebration={celebration} onDone={() => setCelebration(null)} />
      </Shell>
    );
  }

  // --- render: picker ---

  if (stage === 'picker') {
    return (
      <Shell step="profile">
        <Card>
          <MemberTypePicker selected={memberType} busy={pickerBusy} onSelect={pickType} />
          {error && (
            <p className="mt-4 text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  // --- render: review ---

  if (stage === 'review' && memberType) {
    return (
      <Shell step="review">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <Card>
            <div className="mb-4 flex items-center gap-3">
              <EarnCoin size={36} glow className="flex-none" />
              <div>
                <div className="text-[14px] font-semibold tracking-[-0.015em] text-fg-1">
                  Here&apos;s your verified profile
                </div>
                <p className="text-[12px] text-fg-4">
                  Review everything, then publish your Proof of Truth.
                </p>
              </div>
            </div>

            <ProfileLadder ladder={computeLadder(memberType, answers)} className="mb-4" />

            <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-1">
              {questions.map((q) => {
                const value = answers[q.id] ?? '';
                const display = q.kind === 'tags' ? splitTags(value).join(', ') : value.trim();
                return (
                  <div
                    key={q.id}
                    className="flex items-start justify-between gap-4 border-b border-hairline py-2.5 last:border-0"
                  >
                    <span className="flex-none text-[12px] text-fg-4">{q.label}</span>
                    <span className="min-w-0 break-words text-right text-[12.5px] font-medium text-fg-1">
                      {display || '—'}
                    </span>
                  </div>
                );
              })}
            </div>

            {error && (
              <p className="mt-4 text-[12px] text-danger" role="alert">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-between gap-3">
              <Button
                variant="ghost"
                icon={ArrowLeft}
                disabled={submitting}
                onClick={() => {
                  setStage('qa');
                  setIndex(questions.length - 1);
                }}
              >
                Back
              </Button>
              <Button variant="primary" icon={Sparkles} disabled={submitting} onClick={finish}>
                {submitting ? 'Publishing…' : 'Publish profile'}
              </Button>
            </div>
          </Card>

          <div className="lg:sticky lg:top-4 lg:self-start">
            <LiveProfilePanel memberType={memberType} answers={answers} />
          </div>
        </div>
      </Shell>
    );
  }

  // --- render: Q&A ---

  if (!question || !memberType) return null;

  const isLast = index === questions.length - 1;
  const canAdvance = isApproved || !!question.optional;
  // The readiness ladder + the next field that still needs work (the wizard
  // loop): jump straight to the highest open rung instead of paging linearly.
  const ladder = computeLadder(memberType, answers);
  const nextGap = nextGapIndex(memberType, answers, index);

  return (
    <Shell step="profile" pct={pct}>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card className="flex flex-col gap-5">
          <ProfileLadder ladder={ladder} variant="compact" />
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-fg-4">
              <span>
                {MEMBER_TYPE_LABELS[memberType]} · question {index + 1} of {questions.length}
              </span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <ProgressBar value={pct} height={6} gradient="linear-gradient(90deg,#F7C948,#E5A823)" />
          </div>

          {/* Earn asks */}
          <div className="flex gap-3">
            <EarnCoin size={32} glow online className="mt-0.5 flex-none" />
            <div className="min-w-0 flex-1 rounded-2xl rounded-tl-sm border border-hairline bg-surface-1 px-4 py-3">
              <p className="text-[13.5px] leading-relaxed text-fg-1">{question.prompt}</p>
            </div>
          </div>

          {/* Earn recommends — only on the Recommend button (never auto). */}
          <Recommendations
            requested={rec.requested}
            loading={rec.loading}
            degraded={rec.degraded}
            insight={rec.insight}
            options={rec.options}
            approvedValue={approvedValue}
            onRequest={requestRecommendations}
            onApprove={approveValue}
            onDislike={dislikeOption}
            onRegenerate={regenerate}
          />

          {/* The member can type their own answer; it only enters the profile
              once approved. */}
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Your answer
            </div>
            <QuestionField
              question={question}
              value={typedValue}
              onChange={(v) => setTyped(question.id, v)}
              inputRef={inputRef}
            />
            <div className="flex items-center gap-2">
              <Button
                variant="gold"
                size="sm"
                icon={Check}
                disabled={typedValue.trim().length === 0}
                onClick={() => approveValue(typedValue)}
              >
                Approve
              </Button>
              {isApproved ? (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-gold-1">
                  <Check size={13} strokeWidth={2.2} aria-hidden />
                  Approved — in your profile
                </span>
              ) : (
                <span className="text-[11.5px] text-fg-4">
                  Nothing enters your profile until you approve it.
                </span>
              )}
            </div>
          </div>

          {error && (
            <p className="text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-between gap-3">
            <Button variant="ghost" icon={ArrowLeft} onClick={goBack}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              {question.optional && !isApproved && (
                <Button variant="ghost" icon={SkipForward} onClick={goNext}>
                  Skip
                </Button>
              )}
              {/* Wizard loop: jump to the next open field, or close out to Review
                  once every required field reads strong. */}
              {isApproved && nextGap >= 0 && nextGap !== index ? (
                <Button variant="gold" iconRight={Zap} onClick={() => setIndex(nextGap)}>
                  Next gap
                </Button>
              ) : isApproved && nextGap === -1 ? (
                <Button variant="primary" iconRight={Check} onClick={() => setStage('review')}>
                  Review
                </Button>
              ) : (
                <Button
                  variant="primary"
                  iconRight={isLast ? Check : ArrowRight}
                  disabled={!canAdvance}
                  onClick={goNext}
                >
                  {isLast ? 'Review' : 'Next'}
                </Button>
              )}
            </div>
          </div>
        </Card>

        <div className="lg:sticky lg:top-4 lg:self-start">
          <LiveProfilePanel memberType={memberType} answers={answers} />
        </div>
      </div>
    </Shell>
  );
}

// --- field renderer ---

function QuestionField({
  question,
  value,
  onChange,
  inputRef
}: {
  question: ProfileQuestion;
  value: string;
  onChange: (value: string) => void;
  inputRef: React.MutableRefObject<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
  >;
}) {
  if (question.kind === 'textarea') {
    return (
      <textarea
        ref={(n) => {
          inputRef.current = n;
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={question.placeholder}
        rows={4}
        className="w-full resize-y rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-sm leading-relaxed text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)] focus:shadow-[0_0_0_3px_var(--accent-soft)]"
        aria-label={question.label}
      />
    );
  }

  if (question.kind === 'select') {
    return (
      <Select
        ref={(n) => {
          inputRef.current = n;
        }}
        aria-label={question.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={question.placeholder ?? 'Select one…'}
        options={question.options ?? []}
      />
    );
  }

  if (question.kind === 'tags') {
    return (
      <TagInput
        ref={(n) => {
          inputRef.current = n;
        }}
        value={splitTags(value)}
        onChange={(tags) => onChange(tags.join(', '))}
        placeholder={question.placeholder ?? 'Add a few and press enter'}
      />
    );
  }

  // text | url
  return (
    <Input
      ref={(n) => {
        inputRef.current = n;
      }}
      aria-label={question.label}
      type={question.kind === 'url' ? 'url' : 'text'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={question.placeholder}
    />
  );
}

// --- chrome ---

function Shell({
  children,
  step,
  pct
}: {
  children: React.ReactNode;
  step: OnboardingStep;
  pct?: number;
}) {
  return (
    <main className="min-h-screen bg-bg-0 px-4 py-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 flex items-center gap-2.5">
          <EarnCoin size={30} className="flex-none" />
          <div className="text-base font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
          <Badge tone="gold" className="ml-1 px-2 py-px text-[10.5px]">
            Proof of Truth
          </Badge>
          {step !== 'done' ? (
            <Link
              href="/command-center"
              className="ml-auto text-[11.5px] font-medium text-fg-4 transition hover:text-fg-1"
            >
              Saved · finish later
            </Link>
          ) : null}
        </div>

        <OnboardingStepper current={step} pct={pct} className="mb-5" />

        {children}
      </div>
    </main>
  );
}
