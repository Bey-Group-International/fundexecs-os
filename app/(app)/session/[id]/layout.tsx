import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import type { Session, Task } from "@/lib/supabase/database.types";
import { ActiveSessionSetter } from "@/components/session/active-session";
import type { BarTask } from "@/components/session/SessionCommandBar";

export const dynamic = "force-dynamic";

// The session frame publishes its session into the global top bar (which then
// shows Session Name + Share + ⋮ Session Actions). The bar itself lives in the
// app shell, so switching modules below never reloads or exits the session.
export default async function SessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();
  const { data } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", params.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!data) notFound();
  const session = data as Session;

  const { data: taskData } = await supabase
    .from("tasks")
    .select("*")
    .eq("session_id", session.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const tasks: BarTask[] = ((taskData ?? []) as Task[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
  }));

  return (
    <>
      <ActiveSessionSetter
        session={{ id: session.id, name: session.name, color: session.color }}
        tasks={tasks}
      />
      {children}
    </>
  );
}
