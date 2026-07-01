import { Metadata } from "next";
import { MeetingRoom } from "./MeetingRoom";

interface Props {
  params: Promise<{ roomId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { roomId } = await params;
  return {
    title: `Meeting ${roomId} — FundExecs OS`,
    description: "Live video meeting with AI copilot.",
  };
}

export default async function MeetingRoomPage({ params }: Props) {
  const { roomId } = await params;
  return <MeetingRoom roomCode={roomId} />;
}
