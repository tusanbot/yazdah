-- Complete the playable state machines for penalty, card battle, quiz, player guessing and survival.
-- The draft engine and its 30-second automatic pick are defined in migration 022.

create or replace function public.start_group_game(p_game_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.group_games%rowtype;
  v_users uuid[];
  v_first uuid;
  v_state jsonb;
  v_cards jsonb;
  v_questions jsonb;
  v_hand1 jsonb;
  v_hand2 jsonb;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.created_by_user_id<>p_actor_user_id then raise exception 'group_game_creator_required' using errcode='42501'; end if;
  if g.status<>'open' then raise exception 'group_game_not_open' using errcode='22023'; end if;
  select array_agg(user_id order by joined_at) into v_users from public.group_game_participants where game_id=p_game_id;
  if coalesce(array_length(v_users,1),0)<2 then raise exception 'group_game_needs_two_players' using errcode='22023'; end if;
  if g.game_type in ('draft','penalty','cards') and array_length(v_users,1)<>2 then raise exception 'group_game_needs_two_players' using errcode='22023'; end if;
  v_first:=v_users[1+floor(random()*array_length(v_users,1))::int];

  if g.game_type='draft' then
    select jsonb_build_object(
      'goalkeeper',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='goalkeeper' order by random() limit 10) x),
      'defender',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='defender' order by random() limit 10) x),
      'midfielder',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='midfielder' order by random() limit 10) x),
      'attacker',(select jsonb_agg(to_jsonb(x)) from (select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards where position_group='attacker' order by random() limit 10) x)
    ) into v_state;
    v_state:=v_state||jsonb_build_object('round',1,'roundStarter',v_first,'currentTurn',v_first,
      'picks',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb),'used','[]'::jsonb,'lastStarter',null);
  elsif g.game_type in ('quiz','survival') then
    select jsonb_agg(to_jsonb(x)) into v_questions from (
      select id,category,prompt,options,correct_index,explanation from public.group_quiz_questions order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('questions',v_questions,'round',1,'answers','{}'::jsonb,'activeUsers',to_jsonb(v_users));
  elsif g.game_type='guess' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality,clues from public.group_legend_cards order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('players',v_cards,'round',1,'answers','{}'::jsonb,
      'hintLevels',(select jsonb_object_agg(user_id::text,1) from public.group_game_participants where game_id=p_game_id));
  elsif g.game_type='cards' then
    select jsonb_agg(to_jsonb(x)) into v_cards from (
      select id,full_name,position_group,overall,rarity,nationality from public.group_legend_cards order by random() limit 10
    ) x;
    v_state:=jsonb_build_object('round',1,'hands',jsonb_build_object(v_users[1]::text,coalesce(v_cards,'[]'::jsonb),v_users[2]::text,coalesce(v_cards,'[]'::jsonb)),
      'selected','{}'::jsonb,'used',jsonb_build_object(v_users[1]::text,'[]'::jsonb,v_users[2]::text,'[]'::jsonb));
  else
    v_state:=jsonb_build_object('round',1,'actions','{}'::jsonb,'users',to_jsonb(v_users));
  end if;

  update public.group_games set status='active',state=v_state,current_round=1,started_at=now(),
    deadline_at=now()+interval '30 seconds' where id=p_game_id;
  return v_state;
end;
$$;

create or replace function public.submit_group_game_action(
  p_game_id uuid,p_user_id uuid,p_action jsonb,p_auto boolean default false
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.group_games%rowtype;
  v_users uuid[];
  v_active uuid[];
  v_round integer;
  v_answers jsonb;
  v_actions jsonb;
  v_selected jsonb;
  v_value text;
  v_correct integer;
  v_score integer:=0;
  v_card jsonb;
  v_hand jsonb;
  v_used jsonb;
  v_shooter uuid;
  v_keeper uuid;
  v_winner uuid;
  v_top integer;
  v_ties uuid[];
  v_done integer;
  v_total integer;
  v_chat bigint;
  v_part record;
  v_balance bigint;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found then raise exception 'group_game_not_found' using errcode='P0002'; end if;
  if g.status<>'active' then raise exception 'group_game_not_active' using errcode='22023'; end if;
  if not p_auto and g.deadline_at<=now() then raise exception 'group_game_turn_expired' using errcode='22023'; end if;
  if not exists(select 1 from public.group_game_participants where game_id=p_game_id and user_id=p_user_id and status='active') then
    raise exception 'group_game_participant_required' using errcode='42501';
  end if;
  select array_agg(user_id order by joined_at) into v_users from public.group_game_participants where game_id=p_game_id;
  v_round:=coalesce((g.state->>'round')::integer,1);
  v_chat:=g.telegram_chat_id;

  if g.game_type='cards' then
    v_hand:=g.state->'hands'->p_user_id::text;
    v_used:=coalesce(g.state->'used'->p_user_id::text,'[]'::jsonb);
    if p_auto then
      select value into v_card from jsonb_array_elements(v_hand)
        where not (v_used ? (value->>'id'))
        order by ((value->>'overall')::int + case when value->>'rarity'='mythic' then 5 else 0 end) desc limit 1;
    else
      select value into v_card from jsonb_array_elements(v_hand)
        where value->>'id'=p_action->>'cardId' and not (v_used ? (value->>'id')) limit 1;
    end if;
    if v_card is null then raise exception 'group_card_unavailable' using errcode='22023'; end if;
    v_score:=(v_card->>'overall')::integer+case when v_card->>'rarity'='mythic' then 5 else 0 end;
    update public.group_game_participants set score=score+v_score,picks=picks||jsonb_build_array(v_card)
      where game_id=p_game_id and user_id=p_user_id;
    v_selected:=coalesce(g.state->'selected','{}'::jsonb)||jsonb_build_object(p_user_id::text,v_card->>'id');
    v_used:=v_used||to_jsonb(v_card->>'id');
    if (select count(*) from jsonb_object_keys(v_selected))=2 then
      if v_round>=5 then
        select max(score) into v_top from public.group_game_participants where game_id=p_game_id;
        select array_agg(user_id) into v_ties from public.group_game_participants where game_id=p_game_id and score=v_top;
        v_winner:=case when array_length(v_ties,1)=1 then v_ties[1] else null end;
        update public.group_game_participants set status=case when user_id=any(coalesce(v_ties,'{}'::uuid[])) then case when v_winner is null then 'completed' else 'winner' end else 'completed' end
          where game_id=p_game_id;
        update public.group_games set status='completed',completed_at=now(),deadline_at=null,winner_user_id=v_winner,
          state=state||jsonb_build_object('winner',v_winner,'finalScores',(select jsonb_object_agg(user_id::text,score) from public.group_game_participants where game_id=p_game_id))
          where id=p_game_id;
        if g.prize_pool>0 then perform public.settle_group_game_prize(p_game_id,case when v_winner is not null then array[v_winner] else coalesce(v_ties,'{}'::uuid[]) end); end if;
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id loop
          perform public.record_group_mission_event(v_chat,v_part.user_id,'game_completed','complete:'||p_game_id||':'||v_part.user_id);
        end loop;
        if v_winner is not null then perform public.record_group_mission_event(v_chat,v_winner,'game_won','win:'||p_game_id||':'||v_winner); end if;
        perform public.record_group_mission_event(v_chat,v_users[1],'group_game_completed','group-complete:'||p_game_id);
        return jsonb_build_object('completed',true,'winner',v_winner);
      end if;
      update public.group_games set state=jsonb_set(
        jsonb_set(jsonb_set(state,'{round}',to_jsonb(v_round+1),true),array['used',p_user_id::text],v_used,true),
        '{selected}','{}'::jsonb,true
      ),current_round=v_round+1,deadline_at=now()+interval '30 seconds' where id=p_game_id;
    else
      update public.group_games set state=jsonb_set(
        jsonb_set(state,'{selected}',v_selected,true),array['used',p_user_id::text],v_used,true
      ),deadline_at=now()+interval '30 seconds' where id=p_game_id;
    end if;
    return jsonb_build_object('completed',false,'round',v_round,'scoreAdded',v_score);

  elsif g.game_type='penalty' then
    v_value:=case when p_auto then (array['left','center','right'])[1+floor(random()*3)::int] else p_action->>'choice' end;
    if v_value not in ('left','center','right') then raise exception 'penalty_choice_invalid' using errcode='22023'; end if;
    v_actions:=coalesce(g.state->'actions','{}'::jsonb);
    if v_actions ? p_user_id::text then raise exception 'group_game_action_already_submitted' using errcode='23505'; end if;
    v_actions:=v_actions||jsonb_build_object(p_user_id::text,v_value);
    if (select count(*) from jsonb_object_keys(v_actions))=2 then
      v_shooter:=case when mod(v_round,2)=1 then v_users[1] else v_users[2] end;
      v_keeper:=case when v_shooter=v_users[1] then v_users[2] else v_users[1] end;
      if (v_actions ->> (v_shooter::text)) <> (v_actions ->> (v_keeper::text)) then
        update public.group_game_participants set score=score+1 where game_id=p_game_id and user_id=v_shooter;
      end if;
      if v_round>=10 then
        select max(score) into v_top from public.group_game_participants where game_id=p_game_id;
        select array_agg(user_id) into v_ties from public.group_game_participants where game_id=p_game_id and score=v_top;
        v_winner:=case when array_length(v_ties,1)=1 then v_ties[1] else null end;
        update public.group_game_participants set status=case when user_id=any(coalesce(v_ties,'{}'::uuid[])) then 'winner' else 'completed' end where game_id=p_game_id;
        update public.group_games set status='completed',completed_at=now(),deadline_at=null,winner_user_id=v_winner,
          state=state||jsonb_build_object('winner',v_winner,'finalScores',(select jsonb_object_agg(user_id::text,score) from public.group_game_participants where game_id=p_game_id))
          where id=p_game_id;
        if g.prize_pool>0 then perform public.settle_group_game_prize(p_game_id,case when v_winner is not null then array[v_winner] else coalesce(v_ties,'{}'::uuid[]) end); end if;
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id loop
          perform public.record_group_mission_event(v_chat,v_part.user_id,'game_completed','complete:'||p_game_id||':'||v_part.user_id);
        end loop;
        if v_winner is not null then perform public.record_group_mission_event(v_chat,v_winner,'game_won','win:'||p_game_id||':'||v_winner); end if;
        perform public.record_group_mission_event(v_chat,v_users[1],'group_game_completed','group-complete:'||p_game_id);
        return jsonb_build_object('completed',true,'winner',v_winner);
      end if;
      update public.group_games set state=jsonb_set(jsonb_set(state,'{round}',to_jsonb(v_round+1),true),'{actions}','{}'::jsonb,true),
        current_round=v_round+1,deadline_at=now()+interval '30 seconds' where id=p_game_id;
    else
      update public.group_games set state=jsonb_set(state,'{actions}',v_actions,true),deadline_at=now()+interval '30 seconds' where id=p_game_id;
    end if;
    return jsonb_build_object('completed',false,'round',v_round);

  elsif g.game_type in ('quiz','guess','survival') then
    v_answers:=coalesce(g.state->'answers','{}'::jsonb);
    if v_answers ? p_user_id::text then raise exception 'group_game_action_already_submitted' using errcode='23505'; end if;
    if g.game_type='quiz' then
      v_value:=case when p_auto then '-1' else p_action->>'answer' end;
      if v_value is null or v_value !~ '^[0-3]$' then
        if not p_auto then raise exception 'quiz_answer_invalid' using errcode='22023'; end if;
      end if;
      v_answers:=v_answers||jsonb_build_object(p_user_id::text,coalesce(v_value,'-1'));
    elsif g.game_type='guess' then
      v_value:=case when p_auto then '' else lower(trim(coalesce(p_action->>'guess',''))) end;
      if length(v_value)>100 then raise exception 'guess_too_long' using errcode='22023'; end if;
      v_answers:=v_answers||jsonb_build_object(p_user_id::text,jsonb_build_object('guess',v_value,'clueLevel',greatest(1,least(3,coalesce((p_action->>'clueLevel')::int,3)))));
    else
      v_value:=case when p_auto then '-1' else p_action->>'answer' end;
      if v_value is null or v_value !~ '^[0-3]$' then
        if not p_auto then raise exception 'survival_answer_invalid' using errcode='22023'; end if;
      end if;
      v_answers:=v_answers||jsonb_build_object(p_user_id::text,coalesce(v_value,'-1'));
    end if;
    update public.group_games set state=jsonb_set(state,'{answers}',v_answers,true) where id=p_game_id;
    select count(*) into v_done from jsonb_object_keys(v_answers);
    if g.game_type='survival' then
      select count(*) into v_total from public.group_game_participants where game_id=p_game_id and status='active';
    else
      select count(*) into v_total from public.group_game_participants where game_id=p_game_id;
    end if;
    if v_done>=v_total then
      if g.game_type='quiz' then
        select correct_index into v_correct from public.group_quiz_questions where id=g.state->'questions'->(v_round-1)->>'id';
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id loop
          if (v_answers->>v_part.user_id::text)::int=v_correct then
            update public.group_game_participants set score=score+10 where game_id=p_game_id and user_id=v_part.user_id;
            perform public.record_group_mission_event(v_chat,v_part.user_id,'quiz_correct','quiz-correct:'||p_game_id||':'||v_round||':'||v_part.user_id);
          end if;
        end loop;
      elsif g.game_type='guess' then
        v_value:=lower(trim(g.state->'players'->(v_round-1)->>'full_name'));
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id loop
          if lower(trim(v_answers->v_part.user_id::text->>'guess'))=v_value then
            update public.group_game_participants set score=score+greatest(1,11-coalesce((v_answers->v_part.user_id::text->>'clueLevel')::int,3)*3) where game_id=p_game_id and user_id=v_part.user_id;
          end if;
        end loop;
      else
        select correct_index into v_correct from public.group_quiz_questions where id=g.state->'questions'->(v_round-1)->>'id';
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id and status='active' loop
          if (v_answers->>v_part.user_id::text)::int=v_correct then
            update public.group_game_participants set score=score+1 where game_id=p_game_id and user_id=v_part.user_id;
          else
            update public.group_game_participants set status='eliminated' where game_id=p_game_id and user_id=v_part.user_id;
          end if;
        end loop;
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id and status='active' loop
          perform public.record_group_mission_event(v_chat,v_part.user_id,'survival_survived','survival-round:'||p_game_id||':'||v_round||':'||v_part.user_id);
        end loop;
      end if;
      select array_agg(user_id) into v_active from public.group_game_participants where game_id=p_game_id and status='active';
      if g.game_type='survival' and (coalesce(array_length(v_active,1),0)<=1 or v_round>=10) then
        if array_length(v_active,1)=1 then v_winner:=v_active[1];
        else
          select max(score) into v_top from public.group_game_participants where game_id=p_game_id and status='active';
          select array_agg(user_id) into v_ties from public.group_game_participants where game_id=p_game_id and status='active' and score=v_top;
          v_winner:=case when array_length(v_ties,1)=1 then v_ties[1] else null end;
        end if;
      elsif g.game_type<>'survival' and v_round>=10 then
        select max(score) into v_top from public.group_game_participants where game_id=p_game_id;
        select array_agg(user_id) into v_ties from public.group_game_participants where game_id=p_game_id and score=v_top;
        v_winner:=case when array_length(v_ties,1)=1 then v_ties[1] else null end;
      else
        v_winner:=null;
      end if;
      if (g.game_type='survival' and (coalesce(array_length(v_active,1),0)<=1 or v_round>=10)) or (g.game_type<>'survival' and v_round>=10) then
        update public.group_game_participants set status=case when user_id=v_winner then 'winner' when status='active' then 'completed' else status end where game_id=p_game_id;
        update public.group_games set status='completed',completed_at=now(),deadline_at=null,winner_user_id=v_winner,
          state=state||jsonb_build_object('winner',v_winner,'finalScores',(select jsonb_object_agg(user_id::text,score) from public.group_game_participants where game_id=p_game_id))
          where id=p_game_id;
        if g.prize_pool>0 then perform public.settle_group_game_prize(p_game_id,case when v_winner is not null then array[v_winner] else coalesce(v_ties,'{}'::uuid[]) end); end if;
        for v_part in select user_id from public.group_game_participants where game_id=p_game_id loop
          perform public.record_group_mission_event(v_chat,v_part.user_id,'game_completed','complete:'||p_game_id||':'||v_part.user_id);
        end loop;
        if v_winner is not null then perform public.record_group_mission_event(v_chat,v_winner,'game_won','win:'||p_game_id||':'||v_winner); end if;
        perform public.record_group_mission_event(v_chat,v_users[1],'group_game_completed','group-complete:'||p_game_id);
        return jsonb_build_object('completed',true,'winner',v_winner,'round',v_round);
      end if;
      update public.group_games set state=jsonb_set(jsonb_set(state,'{round}',to_jsonb(v_round+1),true),'{answers}','{}'::jsonb,true),
        current_round=v_round+1,deadline_at=now()+interval '30 seconds' where id=p_game_id;
    else
      update public.group_games set state=jsonb_set(state,'{answers}',v_answers,true),deadline_at=now()+interval '30 seconds' where id=p_game_id;
    end if;
    return jsonb_build_object('completed',false,'round',v_round,'answered',v_done);
  end if;
  raise exception 'group_game_type_unsupported' using errcode='22023';
end;
$$;

create or replace function public.process_expired_group_games(p_limit integer default 50)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g record;
  p record;
  v_action jsonb;
  v_count integer:=0;
begin
  perform public.process_group_draft_timeouts(p_limit);
  for g in select id,game_type,state from public.group_games
    where status='active' and deadline_at<=now() and game_type<>'draft'
    order by deadline_at for update skip locked limit greatest(1,least(coalesce(p_limit,50),100))
  loop
    for p in select user_id from public.group_game_participants
      where game_id=g.id and status='active'
    loop
      if g.game_type='cards' and not (coalesce(g.state->'selected','{}'::jsonb) ? p.user_id::text) then
        v_action:=jsonb_build_object('cardId',null);
      elsif g.game_type='penalty' and not (coalesce(g.state->'actions','{}'::jsonb) ? p.user_id::text) then
        v_action:='{}'::jsonb;
      elsif g.game_type in ('quiz','guess','survival') and not (coalesce(g.state->'answers','{}'::jsonb) ? p.user_id::text) then
        v_action:='{}'::jsonb;
      else
        continue;
      end if;
      perform public.submit_group_game_action(g.id,p.user_id,v_action,true);
    end loop;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

insert into public.group_mission_definitions(id,title,description,cadence,scope,event_type,target_count,reward_coins) values
('weekly-draft','استاد درفت','پنج بازیکن را در رقابت‌های درفت انتخاب کن','weekly','member','draft_pick',5,800),
('weekly-survival','بازمانده سرسخت','در پنج مرحله از چالش بقا زنده بمان','weekly','member','survival_survived',5,1000),
('weekly-quiz-master','دانش‌پژوه فوتبال','پنج پاسخ صحیح در چالش‌های اطلاعاتی بده','weekly','member','quiz_correct',5,700),
('monthly-champion','قهرمان ماه','پنج چالش گروهی را ببر','monthly','member','game_won',5,2500)
on conflict(id) do nothing;

revoke all on function public.submit_group_game_action(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.process_expired_group_games(integer) from public,anon,authenticated;
grant execute on function public.submit_group_game_action(uuid,uuid,jsonb,boolean) to service_role;
grant execute on function public.process_expired_group_games(integer) to service_role;


create or replace function public.reveal_group_guess_hint(p_game_id uuid,p_user_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.group_games%rowtype; v_level integer; v_total integer;
begin
  select * into g from public.group_games where id=p_game_id for update;
  if not found or g.game_type<>'guess' or g.status<>'active' then
    raise exception 'guess_game_not_active' using errcode='22023';
  end if;
  if g.deadline_at<=now() then raise exception 'group_game_turn_expired' using errcode='22023'; end if;
  if not exists(select 1 from public.group_game_participants where game_id=p_game_id and user_id=p_user_id and status='active') then
    raise exception 'group_game_participant_required' using errcode='42501';
  end if;
  if g.state->'answers' ? p_user_id::text then
    raise exception 'group_game_action_already_submitted' using errcode='23505';
  end if;
  v_level:=coalesce((g.state->'hintLevels'->>p_user_id::text)::integer,1);
  select jsonb_array_length(clues) into v_total
    from public.group_legend_cards where id=g.state->'players'->((g.state->>'round')::integer-1)->>'id';
  if v_level>=coalesce(v_total,1) then raise exception 'guess_no_more_hints' using errcode='22023'; end if;
  v_level:=v_level+1;
  update public.group_games set state=jsonb_set(state,array['hintLevels',p_user_id::text],to_jsonb(v_level),true)
    where id=p_game_id;
  return v_level;
end;
$$;

revoke all on function public.reveal_group_guess_hint(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reveal_group_guess_hint(uuid,uuid) to service_role;
