import { redirect } from "next/navigation";

// Countersigning is step 3 of the wizard on the envelope's own page; old links (and emails) land there.
export default async function CountersignPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/envelopes/${id}`);
}
