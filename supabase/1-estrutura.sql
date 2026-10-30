-- =====================================================================
-- CABIDINO · estrutura do banco no Supabase
-- Como usar: no Supabase, abra "SQL Editor", cole este arquivo inteiro
-- e clique em "Run". Pode rodar de novo sem problema.
--
-- Quem vê o quê:
--   loja        -> o catálogo do site. Qualquer visitante lê; só a equipe muda.
--   documentos  -> pedidos, financeiro, planilhas, afiliados, equipe e códigos
--                  de etiqueta. Só a equipe (logada e com e-mail confirmado) lê
--                  e muda. A lista da equipe só a Dona muda.
--   fotos       -> fotos das peças. Qualquer visitante vê; só a equipe envia.
-- =====================================================================

create table if not exists public.loja (
  id int primary key default 1 check (id = 1),
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.documentos (
  colecao text not null,
  id text not null,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (colecao, id)
);

alter table public.loja enable row level security;
alter table public.documentos enable row level security;

-- Quem está na equipe: o e-mail da conta (já confirmado) precisa estar na
-- lista guardada em documentos (configuracao / acesso).
create or replace function public.papel_na_equipe()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.value->>'papel'
  from auth.users u
  join public.documentos d on d.colecao = 'configuracao' and d.id = 'acesso'
  cross join lateral jsonb_each(coalesce(d.dados->'usuarios', '{}'::jsonb)) p
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and lower(p.value->>'email') = lower(u.email)
  limit 1
$$;

create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path = public
as $$ select public.papel_na_equipe() is not null $$;

create or replace function public.eh_dona()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce(public.papel_na_equipe() = 'Dona', false) $$;

revoke all on function public.papel_na_equipe() from public;
grant execute on function public.papel_na_equipe() to authenticated;
grant execute on function public.eh_equipe() to anon, authenticated;
grant execute on function public.eh_dona() to anon, authenticated;

-- ---------- loja (catálogo) ----------
drop policy if exists "todos leem a loja" on public.loja;
drop policy if exists "equipe cria a loja" on public.loja;
drop policy if exists "equipe muda a loja" on public.loja;
create policy "todos leem a loja" on public.loja for select to anon, authenticated using (true);
create policy "equipe cria a loja" on public.loja for insert to authenticated with check (public.eh_equipe());
create policy "equipe muda a loja" on public.loja for update to authenticated using (public.eh_equipe()) with check (public.eh_equipe());

-- ---------- documentos (dados particulares) ----------
drop policy if exists "equipe le" on public.documentos;
drop policy if exists "equipe cria" on public.documentos;
drop policy if exists "equipe muda" on public.documentos;
drop policy if exists "equipe apaga" on public.documentos;
create policy "equipe le" on public.documentos for select to authenticated using (public.eh_equipe());
create policy "equipe cria" on public.documentos for insert to authenticated
  with check (public.eh_equipe() and (not (colecao = 'configuracao' and id = 'acesso') or public.eh_dona()));
create policy "equipe muda" on public.documentos for update to authenticated
  using (public.eh_equipe() and (not (colecao = 'configuracao' and id = 'acesso') or public.eh_dona()))
  with check (public.eh_equipe() and (not (colecao = 'configuracao' and id = 'acesso') or public.eh_dona()));
create policy "equipe apaga" on public.documentos for delete to authenticated
  using (public.eh_equipe() and not (colecao = 'configuracao' and id = 'acesso'));

-- o painel atualiza sozinho quando alguém da equipe muda algo
do $$ begin
  alter publication supabase_realtime add table public.documentos;
exception when duplicate_object then null; end $$;

-- ---------- fotos ----------
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "equipe envia fotos" on storage.objects;
drop policy if exists "equipe troca fotos" on storage.objects;
drop policy if exists "equipe apaga fotos" on storage.objects;
create policy "equipe envia fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.eh_equipe());
create policy "equipe troca fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.eh_equipe());
create policy "equipe apaga fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.eh_equipe());

-- ---------- a equipe (a mesma do painel no Claude) ----------
-- A Dona entra com o e-mail abaixo; se for usar outro, troque antes de rodar.
-- Santiago e Alessandra: a Dona coloca o e-mail deles depois, na aba Equipe do painel.
insert into public.documentos (colecao, id, dados)
values ('configuracao', 'acesso', jsonb_build_object('usuarios', jsonb_build_object(
  'isabeladulcesr', jsonb_build_object('nome', 'Isabela Dulce', 'papel', 'Dona', 'email', 'isabeladulcesr@gmail.com'),
  'santiago', jsonb_build_object('nome', 'Santiago', 'papel', 'Gerente geral', 'email', ''),
  'alenoleto', jsonb_build_object('nome', 'Alessandra Noleto', 'papel', 'Gerente de marketing digital', 'email', ''))))
on conflict (colecao, id) do nothing;
