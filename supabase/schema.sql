-- ============================================================================
-- Schema Completo: Cardápio Digital com Supabase (PostgreSQL + RLS + Storage)
-- Execute este script no SQL Editor do seu projeto Supabase.
-- ============================================================================

create extension if not exists "pgcrypto";

-- 1. Tabela de Estabelecimentos
create table if not exists public.estabelecimentos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  nome text not null check (char_length(nome) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$' and char_length(slug) between 2 and 80),
  whatsapp text not null default '',
  chave_pix text not null default '',
  link_pagamento text not null default '',
  horario text not null default '',
  cores jsonb not null default '{
    "primary": "#047857",
    "background": "#F8FAFC",
    "surface": "#FFFFFF",
    "text": "#0F172A"
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Tabela de Categorias (vinculadas ao estabelecimento)
create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 80),
  ordem integer not null default 0,
  visivel boolean not null default true,
  created_at timestamptz not null default now()
);

-- 3. Tabela de Produtos (vinculados ao estabelecimento e categoria)
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  estabelecimento_id uuid not null references public.estabelecimentos(id) on delete cascade,
  categoria_id uuid references public.categorias(id) on delete set null,
  nome text not null check (char_length(nome) between 1 and 120),
  descricao text not null default '' check (char_length(descricao) <= 500),
  preco numeric(10, 2) not null check (preco >= 0),
  foto_url text not null default '',
  visivel boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

-- Índices para consultas rápidas por slug e estabelecimento
create index if not exists idx_estabelecimentos_slug on public.estabelecimentos(slug);
create index if not exists idx_categorias_estab on public.categorias(estabelecimento_id, ordem);
create index if not exists idx_produtos_estab on public.produtos(estabelecimento_id, categoria_id, ordem);

-- Trigger automático para updated_at
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_estabelecimentos_updated_at on public.estabelecimentos;
create trigger trg_estabelecimentos_updated_at
  before update on public.estabelecimentos
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================
alter table public.estabelecimentos enable row level security;
alter table public.categorias enable row level security;
alter table public.produtos enable row level security;

-- Estabelecimentos: leitura pública; escrita apenas pelo dono autenticado
drop policy if exists "Leitura pública de estabelecimentos" on public.estabelecimentos;
create policy "Leitura pública de estabelecimentos"
  on public.estabelecimentos for select
  using (true);

drop policy if exists "Dono cria próprio estabelecimento" on public.estabelecimentos;
create policy "Dono cria próprio estabelecimento"
  on public.estabelecimentos for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "Dono edita próprio estabelecimento" on public.estabelecimentos;
create policy "Dono edita próprio estabelecimento"
  on public.estabelecimentos for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "Dono remove próprio estabelecimento" on public.estabelecimentos;
create policy "Dono remove próprio estabelecimento"
  on public.estabelecimentos for delete
  to authenticated
  using (auth.uid() = owner_id);

-- Categorias: leitura pública das visíveis (e todas para o dono); escrita apenas para o dono
drop policy if exists "Leitura pública de categorias visíveis ou do dono" on public.categorias;
create policy "Leitura pública de categorias visíveis ou do dono"
  on public.categorias for select
  using (
    visivel = true
    or exists (
      select 1 from public.estabelecimentos e
      where e.id = categorias.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono insere categorias" on public.categorias;
create policy "Dono insere categorias"
  on public.categorias for insert
  to authenticated
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = categorias.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono atualiza categorias" on public.categorias;
create policy "Dono atualiza categorias"
  on public.categorias for update
  to authenticated
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = categorias.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = categorias.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono remove categorias" on public.categorias;
create policy "Dono remove categorias"
  on public.categorias for delete
  to authenticated
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = categorias.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

-- Produtos: leitura pública dos visíveis (e todos para o dono); escrita apenas para o dono
drop policy if exists "Leitura pública de produtos visíveis ou do dono" on public.produtos;
create policy "Leitura pública de produtos visíveis ou do dono"
  on public.produtos for select
  using (
    visivel = true
    or exists (
      select 1 from public.estabelecimentos e
      where e.id = produtos.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono insere produtos" on public.produtos;
create policy "Dono insere produtos"
  on public.produtos for insert
  to authenticated
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = produtos.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono atualiza produtos" on public.produtos;
create policy "Dono atualiza produtos"
  on public.produtos for update
  to authenticated
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = produtos.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = produtos.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "Dono remove produtos" on public.produtos;
create policy "Dono remove produtos"
  on public.produtos for delete
  to authenticated
  using (
    exists (
      select 1 from public.estabelecimentos e
      where e.id = produtos.estabelecimento_id
        and e.owner_id = auth.uid()
    )
  );

-- ============================================================================
-- Supabase Storage: Bucket público "produtos" para fotos dos itens
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('produtos', 'produtos', true)
on conflict (id) do update set public = true;

drop policy if exists "Leitura pública das fotos de produtos" on storage.objects;
create policy "Leitura pública das fotos de produtos"
  on storage.objects for select
  using (bucket_id = 'produtos');

drop policy if exists "Dono autenticado envia fotos na própria pasta" on storage.objects;
create policy "Dono autenticado envia fotos na própria pasta"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'produtos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Dono autenticado atualiza próprias fotos" on storage.objects;
create policy "Dono autenticado atualiza próprias fotos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'produtos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Dono autenticado remove próprias fotos" on storage.objects;
create policy "Dono autenticado remove próprias fotos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'produtos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
