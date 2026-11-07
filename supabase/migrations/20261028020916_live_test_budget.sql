-- Live pilot: one issued code = one non-renewable allowance across modules.
-- No browser role can read/write these tables or invoke these functions.
begin;
create table public.live_test_budgets (
 id uuid primary key default gen_random_uuid(), scope text not null,
 code_hash text not null check(length(code_hash)=64),
 remaining_microusd bigint not null default 1000000 check(remaining_microusd between 0 and 1000000),
 status text not null default 'active' check(status in ('active','blocked')),
 expires_at timestamptz not null default (now()+interval '30 days'),
 created_at timestamptz not null default now(), unique(scope,code_hash)
);
create table public.live_test_bindings (
 budget_id uuid not null references public.live_test_budgets(id),
 scope text not null, module text not null check(module in ('support','body')),
 owner_id uuid not null, primary key(scope,module,owner_id), unique(budget_id,module)
);
create table public.live_test_reservations (
 id uuid primary key, budget_id uuid not null references public.live_test_budgets(id),
 wallet_id uuid not null references public.usage_wallets(id),
 scope text not null, module text not null, owner_id uuid not null,
 reserved_microusd bigint not null check(reserved_microusd between 1 and 1000000),
 reserved_credits bigint not null check(reserved_credits between 1 and 20000),
 state text not null default 'pending' check(state in ('pending','active','settled','uncertain')),
 expires_at timestamptz not null default(now()+interval '45 seconds'),
 charged_microusd bigint, provider_session_id text,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create unique index live_one_open_per_budget on public.live_test_reservations(budget_id)
 where state in ('pending','active','uncertain');
alter table public.live_test_budgets enable row level security;
alter table public.live_test_bindings enable row level security;
alter table public.live_test_reservations enable row level security;
revoke all on public.live_test_budgets,public.live_test_bindings,public.live_test_reservations from public,anon,authenticated;
grant select,insert,update on public.live_test_budgets,public.live_test_bindings,public.live_test_reservations to service_role;

create function public.live_budget_bind(p_scope text,p_module text,p_owner_id uuid,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b live_test_budgets; existing live_test_bindings;
begin
 if p_module not in ('support','body') then raise exception 'INVALID_MODULE'; end if;
 select * into b from live_test_budgets where scope=p_scope and code_hash=p_code_hash for update;
 if not found or b.status<>'active' or b.expires_at<=now() then return jsonb_build_object('ok',false,'code','INVALID_CODE'); end if;
 select * into existing from live_test_bindings where scope=p_scope and module=p_module and owner_id=p_owner_id;
 if found then return jsonb_build_object('ok',existing.budget_id=b.id,'code','ALREADY_BOUND'); end if;
 if exists(select 1 from live_test_bindings where budget_id=b.id and module=p_module) then
 return jsonb_build_object('ok',false,'code','CODE_USED'); end if;
 insert into live_test_bindings values(b.id,p_scope,p_module,p_owner_id);
 return jsonb_build_object('ok',true);
end $$;

create function public.live_budget_reserve(p_scope text,p_module text,p_owner_id uuid,p_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b live_test_budgets; w usage_wallets; amount bigint; credits bigint;
begin
 select x.* into b from live_test_budgets x join live_test_bindings y on y.budget_id=x.id
 where y.scope=p_scope and y.module=p_module and y.owner_id=p_owner_id for update of x;
 if not found or b.status<>'active' or b.expires_at<=now() then return jsonb_build_object('ok',false,'code','ACCESS_REQUIRED'); end if;
 -- No automatic release for a claimed or uncertain session, even after a crash.
 if exists(select 1 from live_test_reservations where budget_id=b.id and state in ('pending','active','uncertain')) then
 return jsonb_build_object('ok',false,'code','CONVERSATION_PENDING'); end if;
 select * into w from usage_wallets where owner_id=p_owner_id and module=p_module
 and owner_type=case when p_module='support' then 'anonymous_case' else 'anonymous_profile' end for update;
 if not found or w.status<>'active' then return jsonb_build_object('ok',false,'code','WALLET_UNAVAILABLE'); end if;
 amount:=least(b.remaining_microusd,w.balance*50); -- 20,000 voice credits = $1.
 if amount<50000 then return jsonb_build_object('ok',false,'code','BUDGET_EXHAUSTED'); end if;
 credits:=ceil(amount::numeric/50)::bigint;
 insert into live_test_reservations(id,budget_id,wallet_id,scope,module,owner_id,reserved_microusd,reserved_credits)
 values(p_id,b.id,w.id,p_scope,p_module,p_owner_id,amount,credits);
 update live_test_budgets set remaining_microusd=remaining_microusd-amount where id=b.id;
 update usage_wallets set balance=balance-credits,total_used=total_used+credits where id=w.id;
 insert into usage_ledger(wallet_id,entry_type,amount,balance_before,balance_after,resource_type,request_id,module,metadata)
 values(w.id,'usage_debit',credits,w.balance,w.balance-credits,'live_reserve','live-reserve-'||p_id,p_module,jsonb_build_object('reservation_id',p_id));
 return jsonb_build_object('ok',true,'id',p_id,'reserved_microusd',amount,'reserved_credits',credits);
end $$;

create function public.live_budget_claim(p_id uuid,p_scope text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r live_test_reservations; b live_test_budgets;
begin
 select x.* into b from live_test_budgets x join live_test_reservations y on y.budget_id=x.id
 where y.id=p_id and y.scope=p_scope for update of x;
 if not found or b.status<>'active' or b.expires_at<=now() then
 return jsonb_build_object('ok',false,'code','TICKET_USED_OR_EXPIRED'); end if;
 update live_test_reservations set state='active' where id=p_id and scope=p_scope and state='pending' and expires_at>now() returning * into r;
 if not found then return jsonb_build_object('ok',false,'code','TICKET_USED_OR_EXPIRED'); end if;
 return jsonb_build_object('ok',true,'reserved_microusd',r.reserved_microusd);
end $$;

create function public.live_budget_finish(p_id uuid,p_scope text,p_cost bigint,p_confirmed boolean,p_unstarted boolean default false)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r live_test_reservations; w usage_wallets; b live_test_budgets; charged bigint; refund bigint; usedcredits bigint;
begin
 -- Same lock order as reserve: budget, reservation, wallet.
 select x.* into b from live_test_budgets x join live_test_reservations y on y.budget_id=x.id where y.id=p_id and y.scope=p_scope for update of x;
 if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
 select * into r from live_test_reservations where id=p_id for update;
 if r.state in ('settled','uncertain') then return jsonb_build_object('ok',true,'replay',true); end if;
 if p_unstarted and r.state<>'pending' then return jsonb_build_object('ok',false,'code','ALREADY_STARTED'); end if;
 if not p_unstarted and r.state<>'active' then return jsonb_build_object('ok',false,'code','NOT_STARTED'); end if;
 if p_cost is null or p_cost<0 or p_confirmed is null then raise exception 'INVALID_COST'; end if;
 -- An uncertain provider result consumes the reservation and blocks the code.
 charged:=case when p_unstarted then 0 when p_confirmed and p_cost<=r.reserved_microusd then p_cost else r.reserved_microusd end;
 usedcredits:=ceil(charged::numeric/50)::bigint;
 refund:=r.reserved_credits-usedcredits;
 select * into w from usage_wallets where id=r.wallet_id for update;
 update usage_wallets set balance=balance+refund,total_used=total_used-refund where id=w.id;
 update live_test_budgets set remaining_microusd=remaining_microusd+r.reserved_microusd-charged,
 status=case when not p_unstarted and (not p_confirmed or p_cost>r.reserved_microusd) then 'blocked' else status end where id=b.id;
 update live_test_reservations set state=case when p_unstarted or (p_confirmed and p_cost<=reserved_microusd) then 'settled' else 'uncertain' end,
 charged_microusd=charged,finished_at=now() where id=p_id;
 if refund>0 then insert into usage_ledger(wallet_id,entry_type,amount,balance_before,balance_after,resource_type,request_id,module,metadata)
 values(w.id,'refund',refund,w.balance,w.balance+refund,'live_refund','live-refund-'||p_id,r.module,jsonb_build_object('reservation_id',p_id)); end if;
 return jsonb_build_object('ok',true,'charged_microusd',charged,'charged_credits',usedcredits,'remaining_microusd',b.remaining_microusd+r.reserved_microusd-charged);
end $$;
revoke all on function public.live_budget_bind(text,text,uuid,text),public.live_budget_reserve(text,text,uuid,uuid),public.live_budget_claim(uuid,text),public.live_budget_finish(uuid,text,bigint,boolean,boolean) from public,anon,authenticated;
grant execute on function public.live_budget_bind(text,text,uuid,text),public.live_budget_reserve(text,text,uuid,uuid),public.live_budget_claim(uuid,text),public.live_budget_finish(uuid,text,bigint,boolean,boolean) to service_role;
commit;
