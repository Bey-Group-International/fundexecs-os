import type { Metadata } from "next";
import { ScrollDeckShell } from "@/components/scroll-deck/ScrollDeckShell";

export const metadata: Metadata = {
  title: "Scroll Deck",
  description:
    "Chat-driven fund-deck builder — a layout-and-flow study adopted into the FundExecs OS design system.",
};

// Standalone, UI-only builder route. It deliberately lives outside the
// auth-gated (app) group: it carries its own nav rail and needs no session,
// Supabase data, or org context. Everything it shows is mocked in
// components/scroll-deck/mock-data.ts.
export default function ScrollDeckPage() {
  return <ScrollDeckShell />;
}
