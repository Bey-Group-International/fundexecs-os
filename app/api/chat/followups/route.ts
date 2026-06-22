import { requireOrgContext } from "@/lib/auth";
import { earnFollowups } from "@/lib/claude";

export const maxDuration = 30;

// POST /api/chat/followups — given a question + Earn's answer, return 2-3 short
// suggested next prompts. Best-effort; advisory, so it returns an empty list
// rather than erroring when nothing can be generated.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const { body, reply } = await request.json().catch(() => ({}));
  if (typeof body !== "string" || typeof reply !== "string") {
    return Response.json({ suggestions: [] });
  }
  const suggestions = await earnFollowups({ body, reply });
  return Response.json({ suggestions });
}
