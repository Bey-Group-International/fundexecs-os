import { notFound, redirect } from "next/navigation";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub } from "@/lib/supabase/database.types";

const HUB_KEYS: Hub[] = ["build", "source", "run", "execute"];

// A hub page lands on its first module; the module switcher (in the hub layout)
// moves between modules from there.
export default function HubPage({ params }: { params: { hub: string } }) {
  if (!HUB_KEYS.includes(params.hub as Hub)) notFound();
  const hub = HUB_BY_KEY[params.hub as Hub];
  redirect(`/${hub.key}/${hub.modules[0].key}`);
}
