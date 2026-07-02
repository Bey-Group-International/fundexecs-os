import { Suspense } from "react";
import { Metadata } from "next";
import { MeetingRoom } from "@/app/(app)/meetings/[roomId]/MeetingRoom";

interface Props {
  params: Promise<{ roomCode: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { roomCode } = await params;
  return {
    title: `Meeting ${roomCode} — FundExecs OS`,
    description: "Live video meeting.",
  };
}

export default async function PublicMeetingRoomPage({ params }: Props) {
  const { roomCode } = await params;
  return (
    <Suspense>
      <MeetingRoom roomCode={roomCode} />
    </Suspense>
  );
}
