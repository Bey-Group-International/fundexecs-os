"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { BarTask } from "./SessionCommandBar";
import { useEdgeContext } from "@/hooks/useEdgeContext";

// Lets the global top bar adapt to the session you're in. The session frame
// publishes its session here; the bar (rendered once in the app shell) shows
// session-specific items only while a session is active.
export interface ActiveSession {
  id: string;
  name: string;
  color: string | null;
}

interface ActiveSessionValue {
  session: ActiveSession | null;
  tasks: BarTask[];
  set: (session: ActiveSession | null, tasks: BarTask[]) => void;
}

const ActiveSessionContext = createContext<ActiveSessionValue>({
  session: null,
  tasks: [],
  set: () => {},
});

export function ActiveSessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [tasks, setTasks] = useState<BarTask[]>([]);
  return (
    <ActiveSessionContext.Provider
      value={{
        session,
        tasks,
        set: (s, t) => {
          setSession(s);
          setTasks(t);
        },
      }}
    >
      {children}
    </ActiveSessionContext.Provider>
  );
}

export function useActiveSession() {
  return useContext(ActiveSessionContext);
}

// Rendered by the session frame (server) to publish the active session into the
// context, and clear it on unmount (when you leave the session).
export function ActiveSessionSetter({
  session,
  tasks,
}: {
  session: ActiveSession;
  tasks: BarTask[];
}) {
  const { set } = useActiveSession();
  const taskKey = tasks.map((t) => `${t.id}:${t.status}`).join(",");
  useEffect(() => {
    set(session, tasks);
    return () => set(null, []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.name, session.color, taskKey]);

  useEdgeContext(session.id);

  return null;
}
