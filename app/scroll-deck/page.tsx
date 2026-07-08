import type { Metadata } from "next";
import { ScrollDeckShell } from "@/components/scroll-deck/ScrollDeckShell";

export const metadata: Metadata = {
  title: "Scroll Deck",
  description:
    "Chat-driven fund-deck builder — assemble an investor-ready deck section by section with AI.",
};

// Standalone builder route. It deliberately lives outside the auth-gated (app)
// group: it carries its own nav rail and needs no session, Supabase, or org
// context. The chat calls Claude via /api/scroll-deck/chat (with a deterministic
// fallback when ANTHROPIC_API_KEY is absent); the deck persists client-side in
// localStorage via useDeckStore.
export default function ScrollDeckPage() {
  return <ScrollDeckShell />;
}
