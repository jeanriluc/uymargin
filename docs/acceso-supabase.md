# Acceso con Supabase Auth

UyMargin pide sesión para todo. El ingreso es por enlace mágico al correo, y solo entran los correos
invitados. El servidor valida el token en cada llamada a `/api/*` y, además, compara el correo contra
`ALLOWED_EMAILS`.

## 1. Panel de Supabase

1. **Authentication → Sign In / Providers → Email:** proveedor Email activado.
2. **Authentication → Sign In / Providers → "Allow new users to sign up":** desactivado. Así nadie se
   registra solo; la app, además, pide el enlace con `shouldCreateUser: false`.
3. **Authentication → URL Configuration:**
   - *Site URL:* la URL de producción (por ejemplo `https://tu-app.vercel.app`).
   - *Redirect URLs:* la misma URL de producción y, para probar en tu máquina, `http://localhost:3001`.
     Si usás las URLs de vista previa de Vercel, agregalas también (admite comodines).
4. **Authentication → Users → Invite user:** invitá cada correo. El invitado recibe un correo; desde ahí
   en adelante entra pidiendo el enlace en la pantalla de ingreso.
5. **Correo:** el servicio de correo incluido de Supabase tiene un tope bajo de envíos por hora. Para
   pocas personas alcanza; si molesta, configurá un SMTP propio en *Authentication → Emails*.

## 2. SQL

Revisá y aplicá `supabase/migrations/20261008120000_ronda5_acceso.sql` (SQL Editor). Hace tres cosas:

- Agrega `owner_id` y `owner_email` a `uymargin_audits` (quién guardó cada auditoría). Las auditorías son
  compartidas: todos los usuarios con acceso ven y borran todas.
- Deja `uymargin_audits` con RLS activo y sin políticas, y saca la política abierta vieja si existía.
- Crea la tabla `uymargin_rate_limits` y la función `uymargin_rate_hit` para el límite de uso.

Mientras no se aplique: las auditorías se guardan sin autor y el límite de uso se cuenta en la memoria
de cada instancia (aproximado en Vercel). El servidor lo avisa en el registro.

## 3. Variables de entorno

| Variable | Dónde | Secreta |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel y `.env` | No (queda en el navegador) |
| `VITE_SUPABASE_ANON_KEY` | Vercel y `.env` | No (clave pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel y `.env` | **Sí** |
| `ALLOWED_EMAILS` | Vercel y `.env` | Sí (lista de correos, separados por comas) |
| `SUPABASE_URL` | Opcional | No. Si falta, el servidor usa `VITE_SUPABASE_URL` |

Las `VITE_*` se leen al compilar: después de cambiarlas en Vercel hay que volver a desplegar.
`ALLOWED_EMAILS` se lee en cada pedido, pero en Vercel un cambio de variable también requiere un
despliegue nuevo para llegar a las funciones.

Para dar de baja a alguien: sacá su correo de `ALLOWED_EMAILS` (y volvé a desplegar) y borrá o bloqueá
el usuario en el panel. Una sesión ya validada puede seguir sirviendo hasta un minuto.

## 4. Desarrollo local sin login

En `.env`, las dos juntas:

```
AUTH_DISABLED=true
VITE_AUTH_DISABLED=true
```

Solo funcionan con `npm run dev`. Con `NODE_ENV=production` o en Vercel el servidor ignora
`AUTH_DISABLED`, y el build de producción no incluye el atajo del navegador.

## 5. Límite de uso

Por usuario, con ventanas fijas (el día cambia a las 00:00 de Uruguay):

| Grupo | Por minuto | Por día |
|---|---|---|
| Copiloto (`/api/chat`) | 10 | 150 |
| Búsqueda y enlaces (`/api/search-mlu` + `/api/analyze-url`, sumados) | 60 | 1.500 |

Pasado el tope, el servidor responde 429 con `Retry-After`. Los valores están en `server/rateLimit.ts`.
