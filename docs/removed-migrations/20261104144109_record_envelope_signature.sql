create or replace function public.record_envelope_signature(
  p_recipient_id   uuid,
  p_responses      jsonb,
  p_signature      text,
  p_initials       text,
  p_ip             text,
  p_now            timestamptz,
  p_event_metadata jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_envelope_id uuid;
  e public.envelopes%rowtype;
  r public.envelope_recipients%rowtype;
  k text;
  v_remaining int;
  v_completed boolean := false;
begin
  select envelope_id into v_envelope_id from public.envelope_recipients where id = p_recipient_id;
  if v_envelope_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Envelope first, then recipient, always in this order: concurrent signers queue here.
  select * into e from public.envelopes where id = v_envelope_id for update;
  select * into r from public.envelope_recipients where id = p_recipient_id for update;

  if r.status = 'signed' then
    return jsonb_build_object('ok', true, 'already', true, 'completed', e.status = 'completed');
  end if;
  if r.status = 'declined' then
    return jsonb_build_object('ok', false, 'code', 'declined');
  end if;
  if e.status not in ('sent', 'partially_signed') then
    return jsonb_build_object('ok', false, 'code', 'status', 'status', e.status);
  end if;

  for k in select jsonb_object_keys(coalesce(p_responses, '{}'::jsonb)) loop
    update public.envelope_fields
       set response = p_responses ->> k
     where id::text = k and recipient_id = p_recipient_id;
  end loop;

  update public.envelope_recipients
     set status = 'signed', signed_at = p_now, signature_data = p_signature,
         initials_data = p_initials, ip_address = p_ip
   where id = p_recipient_id;

  insert into public.envelope_events (envelope_id, event_type, recipient_id, ip_address, metadata)
  values (e.id, 'signed', p_recipient_id, p_ip, p_event_metadata);

  select count(*) into v_remaining
    from public.envelope_recipients where envelope_id = e.id and status <> 'signed';

  if v_remaining = 0 then
    update public.envelopes set status = 'completed', completed_at = p_now where id = e.id;
    insert into public.envelope_events (envelope_id, event_type) values (e.id, 'completed');
    v_completed := true;
  elsif e.status = 'sent' then
    update public.envelopes set status = 'partially_signed' where id = e.id;
  end if;

  return jsonb_build_object('ok', true, 'already', false, 'completed', v_completed);
end;
$$;

revoke all on function public.record_envelope_signature(uuid, jsonb, text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.record_envelope_signature(uuid, jsonb, text, text, text, timestamptz, jsonb) to service_role;
