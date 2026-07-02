-- 20260702000005_canvas.sql
-- Collaborative Canvas: canvases and canvas_elements tables with RLS.

CREATE TABLE IF NOT EXISTS public.canvases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Untitled Canvas',
  created_by       uuid REFERENCES public.principals(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.canvas_elements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id        uuid NOT NULL REFERENCES public.canvases(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL,
  type             text NOT NULL CHECK (type IN ('sticky','text','shape','arrow','image')),
  x                numeric NOT NULL DEFAULT 0,
  y                numeric NOT NULL DEFAULT 0,
  w                numeric NOT NULL DEFAULT 200,
  h                numeric NOT NULL DEFAULT 120,
  content          text NOT NULL DEFAULT '',
  color            text NOT NULL DEFAULT '#F59E0B',
  from_id          uuid,
  to_id            uuid,
  shape_kind       text,
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_elements_canvas_idx
  ON public.canvas_elements (canvas_id);

ALTER TABLE public.canvases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvas_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members" ON public.canvases
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.organization_members
      WHERE principal_id = auth.uid() LIMIT 1
    )
  );

CREATE POLICY "org members" ON public.canvas_elements
  FOR ALL USING (
    organization_id = (
      SELECT organization_id FROM public.organization_members
      WHERE principal_id = auth.uid() LIMIT 1
    )
  );
