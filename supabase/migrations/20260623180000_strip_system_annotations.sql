-- Strip internal system-prompt annotations from user-visible content.
-- The earn conversation envelope previously injected [Selected reasoning engine: ...]
-- and [Operator mode: ...] prefixes into user messages; these leaked into the DB
-- and surfaced in the session transcript UI. This migration cleans them retroactively.

-- session_messages: strip from user-turn content only
UPDATE session_messages
SET content = trim(
  regexp_replace(
    regexp_replace(
      content,
      '\[Selected reasoning engine:[^\]]*\]\s*',
      '',
      'g'
    ),
    '\[Operator mode:[^\]]*\]\s*',
    '',
    'g'
  )
)
WHERE role = 'user'
  AND content ~ '\[(Selected reasoning engine|Operator mode):[^\]]*\]';

-- tasks.title: strip annotations (approval workflows inherit the user message as title)
UPDATE tasks
SET title = trim(
  regexp_replace(
    regexp_replace(
      title,
      '\[Selected reasoning engine:[^\]]*\]\s*',
      '',
      'g'
    ),
    '\[Operator mode:[^\]]*\]\s*',
    '',
    'g'
  )
)
WHERE title ~ '\[(Selected reasoning engine|Operator mode):[^\]]*\]';

