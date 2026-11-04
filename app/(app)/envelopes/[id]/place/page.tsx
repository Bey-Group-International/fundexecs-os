import { redirect } from "next/navigation";

// Placing blocks is step 1 of the wizard on the envelope's own page; old links land there.
export default async function PlaceBlocksPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  redirect(`/envelopes/${id}`);
}
