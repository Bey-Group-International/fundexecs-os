-- Step 2 of 2: seed the 9 new agents (enum values added in 0027).
INSERT INTO public.ai_agents (key, name, hub, role, color, motion_style, capabilities) VALUES
  ('executive_advisor', 'Executive Advisor', 'source', 'Researches investors, family offices, and strategic partners before first contact. Surfaces intelligence on motivations, portfolio fit, and ideal entry approach.', '#a855f7', 'precise, strategic', array['investor_research','targeting','relationship_intel','first_contact']),
  ('capital_raiser', 'Capital Raiser', 'source', 'Drives LP fundraising and capital formation campaigns. Manages the Founding Capital Circle, anchor LP pipeline, and high-trust investor rooms.', '#ec4899', 'assertive, relationship-driven', array['lp_fundraising','capital_formation','founding_circle','investor_pipeline']),
  ('capital_connector', 'Capital Connector', 'source', 'Secures deal financing and structures the capital stack. Identifies the right lender, equity partner, or structured capital source for each transaction.', '#14b8a6', 'strategic, deal-minded', array['deal_financing','capital_stack','lender_relations','sponsor_finance']),
  ('deal_sourcer', 'Deal Sourcer', 'source', 'Identifies acquisition targets — underperforming, founder-owned, or transitioning businesses. Structures creative financing and positions BGI as the right buyer.', '#f97316', 'sharp, acquisitive', array['deal_flow','acquisition_strategy','seller_outreach','creative_financing']),
  ('rainmaker', 'Rainmaker', 'source', 'Converts high-value prospects into commitments. Qualifies investors, closes capital conversations, and moves serious people from interest to signed terms.', '#fbbf24', 'direct, high-conviction', array['prospect_conversion','capital_closing','qualification','outreach_sequencing']),
  ('lead_generator', 'Lead Generator', 'build', 'Builds and operates digital funnels that capture investors, business owners, operators, and connectors. Integrates CRM, forms, and automation into a measurable pipeline.', '#84cc16', 'systematic, growth-oriented', array['funnel_design','lead_capture','crm_integration','campaign_ops']),
  ('pr_director', 'PR Director', 'build', 'Produces investor materials, pitch decks, CIMs, executive summaries, and PR narratives. Positions BGI as an institutional, culturally distinct investment platform.', '#06b6d4', 'polished, authoritative', array['investor_materials','pitch_decks','cim','brand_narrative','pr']),
  ('seo_disruptor', 'SEO Disruptor', 'build', 'Builds search authority and organic lead generation. Turns BGI content and thought leadership into category-defining visibility that attracts the right capital and deal flow.', '#8b5cf6', 'aggressive, data-driven', array['seo_strategy','content_authority','organic_leads','category_creation']),
  ('curator', 'Curator', 'build', 'Designs private investor rooms and capital formation salons. Curates the right people, experience, and follow-up to convert gatherings into durable capital relationships.', '#d946ef', 'refined, experience-driven', array['event_curation','private_rooms','rsvp_management','post_event_conversion'])
ON CONFLICT (key) DO UPDATE SET
  name = excluded.name,
  hub = excluded.hub,
  role = excluded.role,
  color = excluded.color,
  motion_style = excluded.motion_style,
  capabilities = excluded.capabilities;
