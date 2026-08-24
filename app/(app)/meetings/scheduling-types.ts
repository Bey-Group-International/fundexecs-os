// Shapes the Meetings scheduling UI exchanges with /api/meetings/scheduling.
// Mirrors the serializers in lib/meetings/scheduling-service.
import type { SchedulingAvailabilityRule } from "@/lib/meetings/scheduling";

export interface HostSchedulingPage {
  id: string;
  slug: string;
  displayName: string;
  headline: string | null;
  bio: string | null;
  timezone: string;
  availability: SchedulingAvailabilityRule[];
  bufferMinutes: number;
  minNoticeMinutes: number;
  bookingWindowDays: number;
  isActive: boolean;
}

export interface HostEventType {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  slotIntervalMinutes: number;
  meetingType: string;
  requiresApproval: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface HostBooking {
  id: string;
  eventTypeId: string;
  eventTitle: string | null;
  inviteeName: string;
  inviteeEmail: string;
  inviteeNotes: string | null;
  inviteeTimezone: string;
  startsAt: string;
  endsAt: string;
  status: "pending" | "confirmed" | "declined" | "cancelled";
  cancelledBy: "host" | "invitee" | null;
  cancellationReason: string | null;
  meetingId: string | null;
  createdAt: string;
}

export interface SchedulingSnapshot {
  page: HostSchedulingPage;
  eventTypes: HostEventType[];
  bookings: HostBooking[];
  bookingUrl: string;
}
