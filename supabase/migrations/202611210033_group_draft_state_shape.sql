-- Keep the draft state schema consistent with the pick RPC and API projection.
create or replace function public.start_group_game(p_game_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.group_games%rowtype;
  v_users uuid[];
  v_first uuid;
  v_state jsonb;
  v_cards jsonb;
  v_questions jsonb;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.created_by_user_id<>p_actor_user_id then raise exception 'group_game_creator_required' using errcode='42501'; end if;
  if g.status<>'open' then raise exception 'group_game_not_open' using errcode='22023'; end if;

  select array_agg(user_id order by joined_at) into v_users
    from public.group_game_participants where game_id=p_game_id;
  if coalesce(array_length(v_users,1),0)<2 then
    raise exception 'group_game_needs_two_players' using errcode='22023';
  end if;
  if g.game_type in ('draft','penalty','cards') and array_length(v_users,1)<>2 then
    raise exception 'group_game_needs_two_players' using errcode='22023';
  end if;

  v_first:=v_users[1+floor(random()*array_length(v_users,1))::int];

  if g.game_type='draft' then
    select jsonb_build_object(
      'pools', jsonb_build_object(
      'goalkeeper',(select jsonb_agg(to_jsonb(x)) from (
        select id,full_name,position_group,overall,rarity,nationality
        from public.group_legend_cards where position_group='goalkeeper' order by random() limit 10
      ) x),
      'defender',(select jsonb_agg(to_jsonb(x)) from (
        select id,full_name,position_group,overall,rarity,nationality
        from public.group_legend_cards where position_group='defender' order by random() limit 10
      ) x),
      'midfielder',(select jsonb_agg(to_jsonb(x)) from (
        select id,full_name,position_group,overall,rarity,nationality
        from public.group_legend_cards where position_group='midfielder' order by random() limit 10
      ) x),
      'attacker',(select jsonb_agg(to_jsonb(x)) from (
        select id,full_name,position_group,overall,rarity,nationality
        from public.group_legend_cards where position_group='attacker' order by random() limit 10
      ) x)
      )
    ) into v_state;
    v_state:=v_state||jsonb_build_object(
      'round',1,'roundStarter',v_first,'currentTurn',v_first,
      'picks',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb),
      'used','[]'::jsonb,'lastStarter',null
    );

  elsif g.game_type in ('quiz','survival') then
    select jsonb_agg(to_jsonb(x)) into v_questions from (
      select id,category,prompt,options,correct_index,explanation
      from public.group_quiz_questions order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('questions',v_questions,'round',1,'answers','{}'::jsonb,'activeUsers',to_jsonb(v_users));

  elsif g.game_type='guess' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality,clues
      from public.group_legend_cards order by random() limit 10
    ) x;
    v_state:=jsonb_build_object(
      'players',v_cards,'round',1,'answers','{}'::jsonb,
      'hintLevels',(select jsonb_object_agg(user_id::text,1) from public.group_game_participants where game_id=p_game_id)
    );

  elsif g.game_type='cards' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality
      from public.group_legend_cards order by random() limit 10
    ) x;
    v_state:=jsonb_build_object(
      'round',1,
      'hands',jsonb_build_object(v_users[1]::text,coalesce(v_cards,'[]'::jsonb),v_users[2]::text,coalesce(v_cards,'[]'::jsonb)),
      'selected','{}'::jsonb,
      'used',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb)
    );

  else
    v_state:=jsonb_build_object('round',1,'actions','{}'::jsonb,'users',to_jsonb(v_users));
  end if;

  update public.group_games set status='active',state=v_state,current_round=1,started_at=now(),
    deadline_at=now()+interval '30 seconds' where id=p_game_id;
  return v_state;
end;
$$;

revoke all on function public.start_group_game(uuid,uuid) from public,anon,authenticated;
grant execute on function public.start_group_game(uuid,uuid) to service_role;
