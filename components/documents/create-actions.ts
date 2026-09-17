"use server";

// Starting a document from a template.
//
// The template library could already be applied to a document — but only from
// inside the builder, to a document that already existed. So the path to "use
// the DDQ template" was: create a blank document, open it, find the picker,
// pick the template. Create inverts that: choose the template, get the document.
//
// Like everything else in this module, creating publishes nothing. A document
// reaches an outside reader only by being published into a data room.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { DATA_ROOM_SECTIONS } from "@/lib/data-room";
import { getTemplate } from "@/lib/document-template-library";

const SECTION_KEYS = new Set(DATA_ROOM_SECTIONS.map((s) => s.key));
// A "use server" module may export only async functions, so these stay local.
const LIBRARY = "/build/documents";
const ROOMS = "/build/data_room";

/**
 * Create a document from a template and open it in the builder.
 *
 * The template decides the section unless the caller names one — a key material
 * is filed where KEY_MATERIALS says it belongs, which is not always where the
 * template's own section says (an Executive Summary is marketing collateral
 * filed under overview).
 */
export async function newDocumentFromTemplate(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const template = getTemplate(String(formData.get("template_id") ?? "").trim());
  if (!template) return;

  const requested = String(formData.get("section") ?? "").trim();
  const section = SECTION_KEYS.has(requested) ? requested : template.section;
  const name = String(formData.get("name") ?? "").trim() || template.label;

  const supabase = await createServerClient();
  const { data: created } = await supabase
    .from("documents")
    .insert({
      organization_id: ctx.orgId,
      name,
      doc_type: section,
      content: template.content,
      mime_type: "text/markdown",
      // A scaffold full of [bracketed prompts] is not ready for anyone to read.
      status: "draft",
      uploaded_by: ctx.userId,
    } as never)
    .select("id")
    .maybeSingle();

  revalidatePath(LIBRARY);
  revalidatePath(ROOMS);
  if (created?.id) redirect(`/document/${created.id}`);
}

/**
 * Create an empty document in a section and open it in the builder.
 *
 * Mirrors the Library's "+ New", but takes a name so Create can start a named
 * key material ("Teaser") rather than another "Marketing & Materials".
 */
export async function newBlankDocument(formData: FormData): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;

  const requested = String(formData.get("section") ?? "").trim();
  const sectionDef = DATA_ROOM_SECTIONS.find((s) => s.key === requested);
  if (!sectionDef) return;
  const name = String(formData.get("name") ?? "").trim() || sectionDef.label;

  const supabase = await createServerClient();
  const { data: created } = await supabase
    .from("documents")
    .insert({
      organization_id: ctx.orgId,
      name,
      doc_type: sectionDef.key,
      mime_type: "text/markdown",
      status: "draft",
      uploaded_by: ctx.userId,
    } as never)
    .select("id")
    .maybeSingle();

  revalidatePath(LIBRARY);
  revalidatePath(ROOMS);
  if (created?.id) redirect(`/document/${created.id}`);
}
