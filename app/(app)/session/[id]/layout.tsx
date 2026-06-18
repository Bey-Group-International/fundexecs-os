import { notFound, redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getWalletBalance } from "@/lib/wallet";
import type { Session, Task } from "@/lib/supabase/database.types";
import { SessionCommandBar, type BarTask } from "@/components/session/SessionCommandBar";

export const dynamic = "force-dynamic";

// The session frame. The command bar persists while nested module routes swap
// below it, so switching modules never reloads the page or exits the session.
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

  const [{ data: taskData }, balance] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false })
      .limit(50),
    getWalletBalance(ctx.orgId),
  ]);
  const tasks: BarTask[] = ((taskData ?? []) as Task[]).map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
  }));

  return (
    <div className="-mx-8 -my-8 flex min-h-full flex-col">
      <SessionCommandBar
        sessionId={session.id}
        name={session.name}
        color={session.color}
        balance={balance}
        tasks={tasks}
      />
      <div className="flex-1 px-8 py-8">{children}</div>
    </div>
  );
}
