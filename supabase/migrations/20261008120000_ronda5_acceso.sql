-- Ronda 5: acceso con sesión, autor de las auditorías y contador del límite de uso.
-- NO se ejecutó: revisalo y aplicalo a mano (SQL Editor de Supabase o `supabase db push`).
-- Se puede correr más de una vez sin romper nada.

-- ------------------------------------------------------------------
-- 1. Auditorías: compartidas entre los usuarios permitidos, con autor.
--    El servidor lista y borra todas; owner_id / owner_email solo dicen quién guardó cada una.
--    Las filas que ya existen quedan sin autor (null).
-- ------------------------------------------------------------------
alter table public.uymargin_audits
  add column if not exists owner_id uuid references auth.users (id) on delete set null,
  add column if not exists owner_email text;

-- RLS activo y sin políticas: la clave pública (anon) y los usuarios con sesión no pueden leer ni
-- escribir la tabla desde el navegador. Solo entra el servidor, con la clave secreta (service_role).
alter table public.uymargin_audits enable row level security;

-- Si en algún momento se creó la política abierta que proponía la app vieja, se saca.
drop policy if exists "Allow all on uymargin_audits" on public.uymargin_audits;

-- ------------------------------------------------------------------
-- 2. Límite de uso por usuario: un contador por ventana (minuto y día).
-- ------------------------------------------------------------------
create table if not exists public.uymargin_rate_limits (
  user_id text not null,
  scope text not null,
  window_seconds integer not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, scope, window_seconds, window_start)
);

alter table public.uymargin_rate_limits enable row level security;

-- Suma un uso en la ventana del minuto y en la del día, y devuelve cuántos van en cada una.
-- Es una sola sentencia por ventana (insert ... on conflict), así que dos pedidos simultáneos no se pisan.
create or replace function public.uymargin_rate_hit(
  p_user_id text,
  p_scope text,
  p_minute_start timestamptz,
  p_day_start timestamptz
)
returns table (minute_count integer, day_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_minute integer;
  v_day integer;
begin
  insert into public.uymargin_rate_limits as r (user_id, scope, window_seconds, window_start, hits)
  values (p_user_id, p_scope, 60, p_minute_start, 1)
  on conflict (user_id, scope, window_seconds, window_start)
  do update set hits = r.hits + 1
  returning r.hits into v_minute;

  insert into public.uymargin_rate_limits as r (user_id, scope, window_seconds, window_start, hits)
  values (p_user_id, p_scope, 86400, p_day_start, 1)
  on conflict (user_id, scope, window_seconds, window_start)
  do update set hits = r.hits + 1
  returning r.hits into v_day;

  -- Limpieza: las ventanas de este usuario anteriores a ayer ya no se consultan.
  delete from public.uymargin_rate_limits d
  where d.user_id = p_user_id
    and d.window_start < p_day_start - interval '1 day';

  minute_count := v_minute;
  day_count := v_day;
  return next;
end;
$$;

-- Solo el servidor (service_role) puede llamar a la función.
revoke all on function public.uymargin_rate_hit(text, text, timestamptz, timestamptz) from public;
revoke all on function public.uymargin_rate_hit(text, text, timestamptz, timestamptz) from anon, authenticated;
grant execute on function public.uymargin_rate_hit(text, text, timestamptz, timestamptz) to service_role;
