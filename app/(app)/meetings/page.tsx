import { Metadata } from "next";
import { MeetingLobby } from "./MeetingLobby";

export const metadata: Metadata = {
  title: "Meeting — FundExecs OS",
  description: "Real-time video meetings with AI transcription, live notes, and action items.",
};

export default function MeetingsPage() {
  return <MeetingLobby />;
}
