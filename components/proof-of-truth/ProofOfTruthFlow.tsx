'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { Badge, Button, Card, Input, ProgressBar, Select } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { MEMBER_TYPE_LABELS, type MemberType } from '@/lib/member-types';
import { getQuestionSet, type ProfileQuestion } from '@/lib/proof-of-truth/questions';
import type { ProfileSuggestion } from '@/lib/proof-of-truth/earn-profile';
import type { MemberProfile } from '@/lib/queries/member-profile';
import {
  saveMemberDraft,
  saveMemberProfile,
  setMemberType as setMemberTypeAction
} from '@/lib/actions/member-profile';
import {
  answersToProfileInput,
  completionPct,
  seedAnswers,
  splitTags,
  type Answers
} from './profile-mapping';
import { MemberTypePicker } from './MemberTypePicker';
import { LiveProfilePanel } from './LiveProfilePanel';
import { EarnSuggestion } from './EarnSuggestion';
import { TagInput } from './TagInput';

interface ProofOfTruthFlowProps {
  /** Seeded from `getMemberProfile()` on the server. */
  profile: MemberProfile;
  /** Where to go on Finish. */
  redirectTo?: string;
}

type Stage = 'picker' | 'qa' | 'review' | 'done';

interface SuggestState {
  loading: boolean;
  degraded: boolean;
  suggestion: ProfileSuggestion | null;
}

const IDLE_SUGGEST: SuggestState = { loading: false, degraded: false, suggestion: null };

export function ProofOfTruthFlow({
  profile,
  redirectTo = '/command-center'
}: ProofOfTruthFlowProps) {
  const router = useRouter();

  const [memberType, setMemberType] = useState<MemberType | null>(profile.memberType);
  const [answers, setAnswers] = useState<Answers>(() => seedAnswers(profile));
  const [stage, setStage] = useState<Stage>(profile.memberType ? 'qa' : 'picker');
  const [index, setIndex] = useState(0);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [suggest, setSuggest] = useState<SuggestState>(IDLE_SUGGEST);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);
  // Token guards against a stale fetch resolving onto the wrong question.
  const requestToken = useRef(0);
  // Latest answers, readable inside the suggestion effect without making
  // `answers` a dependency (which would re-fetch on every keystroke). Synced in
  // an effect (never mutated during render).
  const answersRef = useRef(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const questions = memberType ? getQuestionSet(memberType) : [];
  const question: ProfileQuestion | undefined = questions[index];

  // --- answer helpers ---

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [id]: value };
      // Fire-and-forget draft save so the flow is resumable.
      void saveMemberDraft(next);
      return next;
    });
  }, []);

  // --- Earn suggestion fetch (never in the effect body; in an async continuation) ---

  const fetchSuggestion = useCallback(
    (q: ProfileQuestion, currentAnswers: Answers, type: MemberType) => {
      const token = ++requestToken.current;
      setSuggest({ loading: true, degraded: false, suggestion: null });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14_000);

      fetch('/api/earn/profile-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberType: type, questionId: q.id, answers: currentAnswers }),
        signal: controller.signal
      })
        .then((res) => (res.ok ? res.json() : { ok: false, degraded: true }))
        .then((data: { ok?: boolean; degraded?: boolean; suggestion?: ProfileSuggestion }) => {
          if (token !== requestToken.current) return; // superseded
          if (data?.ok && data.suggestion) {
            setSuggest({ loading: false, degraded: false, suggestion: data.suggestion });
          } else {
            setSuggest({ loading: false, degraded: true, suggestion: null });
          }
        })
        .catch(() => {
          if (token !== requestToken.current) return;
          // Error / timeout → degrade to manual entry. Never block.
          setSuggest({ loading: false, degraded: true, suggestion: null });
        })
        .finally(() => clearTimeout(timer));
    },
    []
  );

  // Re-run the suggestion whenever the active question (or member type) changes.
  // setState happens only inside fetchSuggestion's async continuations — never
  // in the effect body — and we look the question up by index so a fresh object
  // reference each render doesn't retrigger the fetch.
  useEffect(() => {
    if (stage !== 'qa' || !memberType) return;
    const q = getQuestionSet(memberType)[index];
    if (!q) return;
    fetchSuggestion(q, answersRef.current, memberType);
    const tokenRef = requestToken;
    return () => {
      // Invalidate any in-flight request for the question we're leaving.
      tokenRef.current++;
    };
  }, [stage, index, memberType, fetchSuggestion]);

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

  function useSuggestion() {
    if (!question || !suggest.suggestion) return;
    setAnswer(question.id, suggest.suggestion.suggestedValue);
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
    setStage('done');
    setTimeout(() => router.push(redirectTo), 1100);
  }

  const pct = memberType ? completionPct(memberType, answers) : 0;

  // --- render: done ---

  if (stage === 'done') {
    return (
      <Shell>
        <Card className="overflow-hidden p-0">
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1">
              <ShieldCheck size={26} strokeWidth={2.1} aria-hidden />
            </span>
            <div className="text-[16px] font-semibold text-fg-1">Your profile is verified</div>
            <Badge tone="gold" className="gap-1 px-2.5 py-1 text-[11.5px]">
              <Zap size={13} strokeWidth={2.2} aria-hidden />
              Proof of Truth complete
            </Badge>
            <p className="text-[12px] text-fg-4">Taking you to your Command Center…</p>
          </div>
        </Card>
      </Shell>
    );
  }

  // --- render: picker ---

  if (stage === 'picker') {
    return (
      <Shell>
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
      <Shell>
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

  return (
    <Shell>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <Card className="flex flex-col gap-5">
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

          {/* Earn suggests (skipped entirely when degraded) */}
          <EarnSuggestion
            loading={suggest.loading}
            suggestion={suggest.suggestion}
            degraded={suggest.degraded}
            onUse={useSuggestion}
            onWriteOwn={focusInput}
          />

          {/* The member answers */}
          <QuestionField
            question={question}
            value={answers[question.id] ?? ''}
            onChange={(v) => setAnswer(question.id, v)}
            inputRef={inputRef}
          />

          {error && (
            <p className="text-[12px] text-danger" role="alert">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-between gap-3">
            <Button variant="ghost" icon={ArrowLeft} onClick={goBack}>
              Back
            </Button>
            <Button
              variant="primary"
              iconRight={index < questions.length - 1 ? ArrowRight : Check}
              onClick={goNext}
            >
              {index < questions.length - 1 ? 'Next' : 'Review'}
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg-0 px-4 py-8 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-[15px] font-bold text-[#070b14]">
            F
          </span>
          <div className="text-base font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </div>
          <Badge tone="gold" className="ml-1 px-2 py-px text-[10.5px]">
            Proof of Truth
          </Badge>
        </div>
        {children}
      </div>
    </main>
  );
}
