// Tests del control de acceso de /api/* y del límite de uso. Sin red: la validación del token y el
// contador son simulados; no se importa server/app.ts (que lee .env) ni Supabase.
import {
  AuthNotConfiguredError,
  bearerToken,
  createAuthMiddleware,
  isAuthDisabled,
  parseAllowedEmails,
  type AuthUser,
  type TokenVerifier,
} from "../server/auth";
import { checkRate, createMemoryRateStore, createRateLimiter, RATE_RULES, type RateStore } from "../server/rateLimit";

let passed = 0;
let total = 0;
function assert(condition: boolean, message: string) {
  total++;
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${message}`);
  } else {
    console.error(`❌ [FAIL] ${message}`);
  }
}

interface FakeResult {
  status: number;
  body: any;
  headers: Record<string, string>;
  nextCalled: boolean;
  user: AuthUser | undefined;
}

/** Corre un middleware de Express con un pedido y una respuesta de mentira. */
async function run(middleware: (req: any, res: any, next: any) => unknown, authorization?: string, user?: AuthUser): Promise<FakeResult> {
  const result: FakeResult = { status: 200, body: undefined, headers: {}, nextCalled: false, user: undefined };
  const res: any = {
    locals: user ? { user } : {},
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
  };
  const req = { headers: authorization === undefined ? {} : { authorization } };
  await middleware(req, res, () => {
    result.nextCalled = true;
  });
  result.user = res.locals.user;
  return result;
}

const ANA: AuthUser = { id: "11111111-1111-4111-8111-111111111111", email: "Ana@Ejemplo.com" };
const BETO: AuthUser = { id: "22222222-2222-4222-8222-222222222222", email: "beto@otro.com" };
let verifierCalls = 0;
const verifyToken: TokenVerifier = async (token) => {
  verifierCalls++;
  if (token === "token-ana") return ANA;
  if (token === "token-beto") return BETO;
  if (token === "token-caido") throw new Error("fetch failed");
  if (token === "token-sin-config") throw new AuthNotConfiguredError();
  return null;
};
const PROD = { NODE_ENV: "production", ALLOWED_EMAILS: "ana@ejemplo.com, carla@ejemplo.com" };

async function main() {
  console.log("--- Token y lista de correos ---");
  assert(bearerToken("Bearer abc.def") === "abc.def", "Lee el token de 'Bearer <token>'");
  assert(bearerToken("bearer abc") === "abc", "Acepta 'bearer' en minúscula");
  assert(bearerToken(undefined) === null && bearerToken("") === null, "Sin encabezado no hay token");
  assert(bearerToken("Basic abc") === null && bearerToken("Bearer") === null, "Otro esquema o 'Bearer' vacío no es un token");
  const allowed = parseAllowedEmails(" Ana@Ejemplo.com ,carla@ejemplo.com,, ");
  assert(allowed.size === 2 && allowed.has("ana@ejemplo.com") && allowed.has("carla@ejemplo.com"), "ALLOWED_EMAILS: separa por comas, sin espacios ni mayúsculas");
  assert(parseAllowedEmails(undefined).size === 0 && parseAllowedEmails("").size === 0, "ALLOWED_EMAILS vacía = lista vacía");

  console.log("\n--- Middleware: 401, 403 y acceso ---");
  const auth = createAuthMiddleware({ verifyToken, env: PROD });

  verifierCalls = 0;
  let r = await run(auth);
  assert(r.status === 401 && r.body.code === "UNAUTHENTICATED" && !r.nextCalled, "Sin token: 401 y no pasa");
  assert(verifierCalls === 0, "Sin token no se consulta a Supabase");
  assert(typeof r.body.message === "string" && r.body.message === r.body.error && /sesión/.test(r.body.message), "El 401 trae un mensaje en español");

  r = await run(auth, "Basic abc");
  assert(r.status === 401 && !r.nextCalled, "Encabezado que no es Bearer: 401");

  r = await run(auth, "Bearer token-falso");
  assert(r.status === 401 && r.body.code === "INVALID_TOKEN" && !r.nextCalled, "Token inválido: 401 y no pasa");
  assert(!JSON.stringify(r.body).includes("token-falso"), "La respuesta no repite el token");

  r = await run(auth, "Bearer token-beto");
  assert(r.status === 403 && r.body.code === "FORBIDDEN_EMAIL" && !r.nextCalled, "Token válido con correo no permitido: 403 y no pasa");
  assert(/correo/.test(r.body.message) && !r.body.message.includes("beto@otro.com"), "El 403 explica el motivo sin listar correos");

  r = await run(auth, "Bearer token-ana");
  assert(r.nextCalled && r.status === 200, "Token válido con correo permitido: pasa");
  assert(r.user?.id === ANA.id && r.user?.email === "ana@ejemplo.com", "Deja el usuario en el pedido, con el correo en minúscula");

  r = await run(createAuthMiddleware({ verifyToken, env: { NODE_ENV: "production" } }), "Bearer token-ana");
  assert(r.status === 403 && !r.nextCalled, "Sin ALLOWED_EMAILS no entra nadie, ni con token válido");

  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  r = await run(auth, "Bearer token-caido");
  const down = r;
  r = await run(auth, "Bearer token-sin-config");
  console.error = originalError;
  assert(down.status === 503 && down.body.code === "AUTH_UNAVAILABLE" && !down.nextCalled, "Si Supabase no responde: 503, no se deja pasar");
  assert(r.status === 503 && r.body.code === "AUTH_NOT_CONFIGURED" && !r.nextCalled, "Sin variables de Supabase en el servidor: 503, no se deja pasar");
  assert(!JSON.stringify(errors).includes("token-caido") && !JSON.stringify(errors).includes("token-sin-config"), "El registro del servidor no incluye el token");
  assert(!JSON.stringify(down.body).includes("fetch failed"), "La respuesta no filtra el error interno");

  console.log("\n--- AUTH_DISABLED ---");
  assert(isAuthDisabled({ AUTH_DISABLED: "true" }), "AUTH_DISABLED=true vale en desarrollo local");
  assert(isAuthDisabled({ AUTH_DISABLED: "true", NODE_ENV: "development" }), "AUTH_DISABLED=true vale con NODE_ENV=development");
  assert(!isAuthDisabled({ AUTH_DISABLED: "true", NODE_ENV: "production" }), "AUTH_DISABLED se ignora con NODE_ENV=production");
  assert(!isAuthDisabled({ AUTH_DISABLED: "true", VERCEL: "1" }), "AUTH_DISABLED se ignora en Vercel");
  assert(!isAuthDisabled({ AUTH_DISABLED: "true", VERCEL: "1", NODE_ENV: "development" }), "AUTH_DISABLED se ignora en Vercel aunque NODE_ENV no sea production");
  assert(!isAuthDisabled({}) && !isAuthDisabled({ AUTH_DISABLED: "1" }) && !isAuthDisabled({ AUTH_DISABLED: "TRUE" }), "Solo el valor exacto 'true' lo activa");

  r = await run(createAuthMiddleware({ verifyToken, env: { AUTH_DISABLED: "true" } }));
  assert(r.nextCalled && r.user?.id === "dev-local", "En desarrollo con AUTH_DISABLED pasa sin token, como usuario de desarrollo");

  r = await run(createAuthMiddleware({ verifyToken, env: { ...PROD, AUTH_DISABLED: "true" } }));
  assert(r.status === 401 && !r.nextCalled, "En producción con AUTH_DISABLED=true, sin token sigue siendo 401");
  r = await run(createAuthMiddleware({ verifyToken, env: { ...PROD, AUTH_DISABLED: "true" } }), "Bearer token-beto");
  assert(r.status === 403 && !r.nextCalled, "En producción con AUTH_DISABLED=true, el correo no permitido sigue siendo 403");
  r = await run(createAuthMiddleware({ verifyToken, env: { VERCEL: "1", AUTH_DISABLED: "true", ALLOWED_EMAILS: "ana@ejemplo.com" } }));
  assert(r.status === 401 && !r.nextCalled, "En Vercel con AUTH_DISABLED=true, sin token sigue siendo 401");

  console.log("\n--- Límite de uso ---");
  const T0 = Date.UTC(2026, 9, 8, 12, 0, 30);
  const rule = { scope: "prueba", perMinute: 3, perDay: 5 };
  let store = createMemoryRateStore();
  const first = [await checkRate(store, "u1", rule, T0), await checkRate(store, "u1", rule, T0 + 1000), await checkRate(store, "u1", rule, T0 + 2000)];
  assert(first.every((d) => d.ok), "Hasta el tope por minuto, pasa");
  let d = await checkRate(store, "u1", rule, T0 + 3000);
  assert(d.ok === false && d.window === "minuto" && d.limit === 3, "El pedido siguiente al tope por minuto se rechaza");
  assert(d.ok === false && d.retryAfterSeconds === 27, "Retry-After = segundos hasta el próximo minuto (27)");
  assert((await checkRate(store, "u2", rule, T0 + 3000)).ok, "El tope es por usuario: otro usuario no se ve afectado");
  assert((await checkRate(store, "u1", { ...rule, scope: "otro" }, T0 + 3000)).ok, "Cada grupo de endpoints cuenta aparte");
  d = await checkRate(store, "u1", rule, T0 + 60_000);
  assert(d.ok, "Al minuto siguiente vuelve a pasar");

  store = createMemoryRateStore();
  for (let i = 0; i < 5; i++) await checkRate(store, "u1", rule, T0 + i * 60_000);
  d = await checkRate(store, "u1", rule, T0 + 5 * 60_000);
  assert(d.ok === false && d.window === "día" && d.limit === 5, "Pasado el tope diario se rechaza aunque el minuto esté libre");
  assert(d.ok === false && d.retryAfterSeconds === 15 * 3600 - 5 * 60 - 30, "Retry-After = segundos hasta la medianoche de Uruguay");
  assert((await checkRate(store, "u1", rule, T0 + 24 * 3600_000)).ok, "Al día siguiente vuelve a pasar");

  // El día cambia a las 00:00 de Uruguay (03:00 UTC).
  const dayRule = { scope: "dia", perMinute: 100, perDay: 1 };
  store = createMemoryRateStore();
  assert((await checkRate(store, "u1", dayRule, Date.UTC(2026, 9, 9, 2, 59, 0))).ok, "23:59 en Uruguay: primer uso del día");
  assert((await checkRate(store, "u1", dayRule, Date.UTC(2026, 9, 9, 3, 0, 0))).ok, "00:00 en Uruguay: ya es otro día, vuelve a pasar");

  assert(RATE_RULES.chat.perMinute === 10 && RATE_RULES.chat.perDay === 150, "Copiloto: 10 por minuto y 150 por día");
  assert(RATE_RULES.market.perMinute === 60 && RATE_RULES.market.perDay === 1500, "Búsqueda y enlaces: 60 por minuto y 1.500 por día");

  let now = T0;
  const shared = createMemoryRateStore();
  const limit = createRateLimiter({ store: () => shared, fallback: createMemoryRateStore(), userId: (res) => res.locals.user.id, now: () => now })(rule);
  for (let i = 0; i < 3; i++) await run(limit, undefined, ANA);
  r = await run(limit, undefined, ANA);
  assert(r.status === 429 && r.body.code === "RATE_LIMITED" && !r.nextCalled, "Middleware: pasado el tope responde 429 y no pasa");
  assert(r.headers["Retry-After"] === "30", "El 429 lleva Retry-After en segundos");
  assert(/límite de 3 usos por minuto/.test(r.body.message) && /30 segundos/.test(r.body.message), "El 429 trae un mensaje en español con el tope y la espera");
  r = await run(limit, undefined, BETO);
  assert(r.nextCalled, "Middleware: otro usuario sigue pasando");

  const broken: RateStore = {
    async hit() {
      throw new Error("PGRST202");
    },
  };
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  now = T0;
  const guarded = createRateLimiter({ store: () => broken, fallback: createMemoryRateStore(), userId: (res) => res.locals.user.id, now: () => now })(rule);
  const results: FakeResult[] = [];
  for (let i = 0; i < 4; i++) results.push(await run(guarded, undefined, ANA));
  console.warn = originalWarn;
  assert(results.slice(0, 3).every((x) => x.nextCalled) && results[3].status === 429, "Si el contador compartido falla, sigue limitando con el contador en memoria");
  assert(warnings.length === 1, "La falla del contador compartido se avisa en el registro, una vez por minuto");

  console.log("\n=================================================");
  console.log(`RESULTADO: ${passed}/${total} casos de acceso y límite de uso`);
  console.log("=================================================");
  if (passed !== total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
