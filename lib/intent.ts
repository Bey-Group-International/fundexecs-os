// lib/intent.ts
// Routes an operator's message to the right kind of response: a conversational
// ANSWER (like Claude/ChatGPT/Gemini) or an agentic TASK (like Tasklet/Cursor —
// a planned, gated workflow). Deterministic and pure so the composer can decide
// client-side without a round-trip, and the API can re-check server-side.
export type EarnIntent = "chat" | "task";

// Verbs that ask Earn to *do* work — these spin up a planned, gated workflow.
const TASK_SIGNAL =
  /\b(build|create|draft|write|generate|model|underwrite|underwriting|source|sources?|prospect|find|search|prepare|compile|analy[sz]e|screen|run|launch|send|email|schedule|review|update|stress.?test|diligence|produce|assemble|automate|outreach|distribute|memo|deck|pipeline|raise|close)\b/i;

// Openers that signal a question Earn should simply answer.
const QUESTION_LEAD =
  /^(what|whats|what's|why|how|when|who|whom|which|where|is|are|am|do|does|did|can|could|should|would|will|won't|may|might|explain|define|describe|summari[sz]e|compare|tell me|walk me|help me understand|give me your|thoughts on)\b/i;

/**
 * Classify a prompt as a conversational "chat" answer or an agentic "task".
 * Questions and short asks become chat; explicit work requests become tasks;
 * longer declarative work descriptions default to task to preserve the agentic
 * product. Empty input is treated as chat.
 */
export function classifyIntent(prompt: string): EarnIntent {
  const p = prompt.trim();
  if (!p) return "chat";

  const isQuestion = p.endsWith("?") || QUESTION_LEAD.test(p);
  const isTask = TASK_SIGNAL.test(p);

  // A clear work verb that isn't phrased as a question → run it.
  if (isTask && !isQuestion) return "task";
  // Anything question-shaped → answer it conversationally.
  if (isQuestion) return "chat";
  // Short, verbless messages (greetings, acks, one-liners) → chat.
  if (p.split(/\s+/).length <= 6) return "chat";
  // Longer declarative messages that still name work → task; else chat.
  return isTask ? "task" : "chat";
}
