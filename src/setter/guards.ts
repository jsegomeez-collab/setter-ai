/**
 * Última barrera antes de enviar lo que escribió la IA. Si algo falla, la respuesta NO sale:
 * se retiene para Jose. Reglas del documento: solo 2 enlaces y un correo permitidos, mensajes cortos,
 * y nunca huecos sin rellenar ([LINK…], [CONFIRMAR…], [COMPLETAR]).
 */

export const MAX_REPLY_CHARS = 1000;
/** Mensajitos por turno y longitud de cada uno: que se lea como un chat, no como un texto de web (petición de Jose). */
export const MAX_MESSAGES = 4;
export const MAX_MESSAGE_CHARS = 300;

export interface AllowedContacts {
  readonly urls: readonly string[];
  readonly emails: readonly string[];
}

export type GuardResult = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

/** Dominios de primer nivel habituales. Lista cerrada a propósito: "EE.UU." o "p.ej." no son enlaces. */
const TLDS = [
  'com', 'net', 'org', 'io', 'ai', 'co', 'me', 'ly', 'app', 'link', 'gg', 'es', 'mx', 'us', 'info', 'biz', 'xyz',
  'site', 'online', 'store', 'shop', 'dev', 'tv', 'ar', 'cl', 'pe', 'uy', 've', 'ec', 'bo', 'py', 'cr', 'do', 'gt',
  'hn', 'ni', 'pa', 'sv', 'pr', 'uk', 'de', 'fr', 'it', 'br', 'ca', 'eu', 'page', 'so', 'to', 'cc', 'vip', 'pro',
  'top', 'club', 'live', 'ws', 'fm', 'sh', 'lat', 'gl', 'gd', 'be', 'bio', 'tech', 'academy',
];
const LINK_PATTERN = new RegExp(`https?://|www\\.|\\b[a-z0-9-]+(\\.[a-z0-9-]+)*\\.(${TLDS.join('|')})\\b`, 'i');
const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PLACEHOLDER_PATTERN = /\[(LINK|CONFIRMAR|COMPLETAR)[^\]]*\]/i;
/** Precios del grupal (1.997) y del VIP (4.997): decisión de Jose, nunca por chat. */
const FORBIDDEN_PRICE_PATTERN = /\b[14][.,\s]?997\b/;
/** Letras de otros alfabetos (cirílico, griego, hebreo, árabe, japonés, chino, coreano): fallo raro del modelo ("te молча"). */
const FOREIGN_SCRIPT_PATTERN = /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿ぀-ヿ一-鿿가-힯]/;

/**
 * Muletillas que Jose no quiere (simulaciones del 2026-10-17). Es estilo, no riesgo: solo piden otro intento,
 * nunca retienen. "vale la pena" es español neutro y se permite.
 */
const MULETILLAS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /(?<![\p{L}])vale(?![\p{L}])(?!\s+la\s+pena)/iu, reason: 'Usa "vale" (es de España; escribe en español neutro)' },
  { pattern: /pasa\s+nada/i, reason: 'Usa la muletilla "no pasa nada" (o "tampoco pasa nada"); no la uses ni parecidas' },
  { pattern: /no\s+hay\s+problema/i, reason: 'Usa la muletilla "no hay problema"; no la uses ni parecidas' },
  { pattern: /(?<![\p{L}])tranquil[oa]s?(?![\p{L}])/iu, reason: 'Usa "tranquilo/a" (palabra con género y muletilla)' },
];

/** Cuántos mensajes anteriores de la cuenta se miran para no empezar igual. */
const SAME_OPENING_WINDOW = 2;

function openingWord(text: string): string {
  return text.trim().toLowerCase().match(/^[\p{L}]+/u)?.[0] ?? '';
}

/** `previous`: mensajes anteriores de la cuenta, del más antiguo al más reciente. */
export function styleIssues(messages: readonly string[], previous: readonly string[] = []): string[] {
  const text = messages.join('\n');
  const issues = MULETILLAS.filter((m) => m.pattern.test(text)).map((m) => m.reason);
  const opening = openingWord(messages[0] ?? '');
  const repeated = opening.length > 0 && previous.slice(-SAME_OPENING_WINDOW).some((p) => openingWord(p) === opening);
  return repeated ? [...issues, `Empieza igual ("${opening}") que uno de tus mensajes anteriores; empieza de otra forma`] : issues;
}

/** Limpia los mensajitos y, si vienen más de MAX_MESSAGES, junta los sobrantes en el último (es formato, no un riesgo). */
export function normalizeMessages(messages: readonly string[]): string[] {
  const clean = messages.map((m) => m.trim()).filter((m) => m.length > 0);
  if (clean.length <= MAX_MESSAGES) return clean;
  return [...clean.slice(0, MAX_MESSAGES - 1), clean.slice(MAX_MESSAGES - 1).join(' ')];
}

/** Quita del texto los enlaces y correos permitidos; lo que quede con pinta de enlace o correo está prohibido. */
function stripAllowed(text: string, allowed: AllowedContacts): string {
  const all = [...allowed.urls, ...allowed.emails].sort((a, b) => b.length - a.length);
  return all.reduce((rest, item) => rest.split(item).join(' '), text);
}

export function checkReply(text: string, allowed: AllowedContacts): GuardResult {
  const reasons: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) reasons.push('Respuesta vacía');
  if (trimmed.length > MAX_REPLY_CHARS) reasons.push(`Respuesta demasiado larga (${trimmed.length} caracteres, máximo ${MAX_REPLY_CHARS})`);
  if (PLACEHOLDER_PATTERN.test(trimmed)) reasons.push('Contiene un hueco sin rellenar del documento');
  if (FORBIDDEN_PRICE_PATTERN.test(trimmed)) reasons.push('Da el precio del grupal o del VIP (prohibido por chat)');
  if (FOREIGN_SCRIPT_PATTERN.test(trimmed)) reasons.push('Tiene letras de otro alfabeto (fallo del modelo)');
  const rest = stripAllowed(trimmed, allowed);
  const emails = rest.match(EMAIL_PATTERN) ?? [];
  if (emails.length > 0) reasons.push(`Correo no permitido: ${emails.join(', ')}`);
  const withoutEmails = rest.replace(EMAIL_PATTERN, ' ');
  const link = withoutEmails.match(LINK_PATTERN);
  if (link) reasons.push(`Enlace no permitido: ${link[0]}`);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

/** Comprueba la tanda de mensajitos: cuántos, que ninguno esté vacío ni sea largo, y el conjunto con checkReply. */
export function checkMessages(messages: readonly string[], allowed: AllowedContacts): GuardResult {
  const reasons: string[] = [];
  if (messages.length > MAX_MESSAGES) reasons.push(`Demasiados mensajes (${messages.length}, máximo ${MAX_MESSAGES})`);
  if (messages.some((m) => m.trim().length === 0)) reasons.push('Hay un mensaje vacío');
  const longest = Math.max(0, ...messages.map((m) => m.trim().length));
  if (longest > MAX_MESSAGE_CHARS) reasons.push(`Un mensaje es demasiado largo (${longest} caracteres, máximo ${MAX_MESSAGE_CHARS})`);
  const whole = checkReply(messages.join('\n'), allowed);
  const all = [...reasons, ...(whole.ok ? [] : whole.reasons)];
  return all.length === 0 ? { ok: true } : { ok: false, reasons: all };
}
