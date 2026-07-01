import { Metadata } from "next";
import { MeetingCopilotConsole } from "./MeetingCopilotConsole";

export const metadata: Metadata = {
  title: "Meeting Copilot — FundExecs OS",
  description: "AI-powered meeting intelligence: sentiment, objections, commitment probability, and follow-up drafting.",
};

export default function MeetingsPage() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold text-[var(--fg-primary)]">Meeting Copilot</h1>
        <p className="text-sm text-[var(--fg-muted)] mt-1">
          Paste a transcript or meeting notes. Earn extracts sentiment, objections, commitment probability, and drafts your follow-up.
        </p>
      </div>
      <MeetingCopilotConsole />
    </div>
  );
}
