-- 20261009180000_live_meeting_transcripts_recognizer.sql
-- What the speech recogniser was given, and what it gave back, per line.
--
-- Read against the host's meetings of 2 to 9 October. Every line of theirs
-- after 2 October 16:26 UTC is three or four punctuated words of nonsense
-- stored at confidence 1.0, while every Chrome guest in the same calls kept
-- twenty-five word sentences with real engine scores. The change at that
-- minute handed the recogniser the call's own microphone track; the transcript
-- turned the moment that path was first taken, mid-call, where the first run
-- had still started bare. Nothing stored says which path a line came from,
-- which browser's engine produced it, or whether the engine scored it at all.
--
-- One nullable jsonb beside each line, written by the transcript save route
-- from what the client reports and bounded to the keys it knows: browser
-- brand, whether the engine exposes track support, how the run was started
-- (track or bare), the run's ordinal and age, the engine's raw confidence,
-- the track's label and the language. Null on every row written before this.
--
-- RLS: live_meeting_transcripts' existing policies apply; the column is
-- written through the service role by the same route that writes the line.

alter table public.live_meeting_transcripts
  add column if not exists recognizer jsonb;

comment on column public.live_meeting_transcripts.recognizer is
  'The recogniser run that produced the line (browser brand, start path, run ordinal and age, raw engine confidence, track label, language). Written by the transcript save route; null before 2026-10-09.';
