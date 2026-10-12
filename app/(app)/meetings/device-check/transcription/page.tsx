import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { TranscriptionCheck } from "./TranscriptionCheck";

export const metadata: Metadata = {
  title: "Test transcription — FundExecs OS",
};

export const dynamic = "force-dynamic";

/**
 * A transcription check without a meeting: which way of feeding this
 * browser's speech recogniser actually hears the picked microphone. Reached
 * from the device check; the answer is what recognizer-input.ts encodes, and
 * this page is how a new browser or a new microphone is read before a call.
 */
export default async function TranscriptionCheckPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return <TranscriptionCheck />;
}
