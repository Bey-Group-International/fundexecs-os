-- 20260917100000_recording_part_timing.sql
-- Where each part sits on the clock, not just in the byte stream.
--
-- Parts already carry `size`, which is enough to answer a Range request: it
-- says where a part sits in the assembled file. It says nothing about where it
-- sits in the MEETING, and that is what a viewer actually asks for when they
-- drag a scrubber.
--
-- The assembled stream is a live-recorded WebM: no duration in its header and
-- no cue index, because neither can be written until a recording that is still
-- running has ended. A browser handed that can play it from the start and
-- little else — the scrubber has no length to scrub and a seek has nothing to
-- seek to. Byte ranges do not help, because a byte offset in the middle of a
-- WebM is not decodable without the header the first part carries.
--
-- Storing when each part starts and how long it lasts is what turns the parts
-- into a timeline: the player knows the real duration, and a seek becomes
-- "which part holds this moment", which is a question these columns answer.
--
-- Nullable, because recordings made before this exist and must keep playing.
-- The timeline falls back to the nominal part length for those.

ALTER TABLE live_meeting_recording_chunks
  ADD COLUMN IF NOT EXISTS offset_ms integer CHECK (offset_ms IS NULL OR offset_ms >= 0),
  ADD COLUMN IF NOT EXISTS duration_ms integer CHECK (duration_ms IS NULL OR duration_ms > 0);

COMMENT ON COLUMN live_meeting_recording_chunks.offset_ms IS
  'Milliseconds from the start of the recording to the start of this part. Null for parts stored before timing was captured.';
COMMENT ON COLUMN live_meeting_recording_chunks.duration_ms IS
  'How long this part runs, measured at capture rather than assumed from the timeslice.';
