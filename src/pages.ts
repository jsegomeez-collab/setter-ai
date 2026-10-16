import type { Account } from './meta/client.js';
import type { TokenStatus } from './meta/token.js';
import type { ActionRow, ContactRow, EventRow } from './store.js';

const MAX_JSON_PREVIEW = 1500;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function jsonPreview(value: unknown): string {
  const text = JSON.stringify(value, null, 1) ?? '';
  return escapeHtml(text.length > MAX_JSON_PREVIEW ? `${text.slice(0, MAX_JSON_PREVIEW)}…` : text);
}

export function status(ok: boolean, yes: string, no: string): string {
  return ok ? `<span class="ok">✔ ${escapeHtml(yes)}</span>` : `<span class="bad">✘ ${escapeHtml(no)}</span>`;
}

const NAV = `<nav><a href="/eventos">Estado y eventos</a> · <a href="/flujos">Flujos</a> · <a href="/contactos">Contactos</a></nav>`;

export function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:#1a1a1a;background:#fafafa}
  h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:28px} nav{margin-bottom:12px}
  table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}
  th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
  pre{white-space:pre-wrap;word-break:break-all;margin:0;font-size:.75rem;max-height:160px;overflow:auto}
  .ok{color:#137333;font-weight:600} .bad{color:#b3261e;font-weight:600} .warn{color:#8a5a00;font-weight:600}
  .card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0}
  .errors{background:#fdecea;border:1px solid #f5c2c0;border-radius:8px;padding:8px 12px;margin:8px 0}
  button{cursor:pointer;padding:6px 10px} form.inline{display:inline}
  label{display:block;margin:10px 0 4px;font-weight:600} small{color:#555;font-weight:400}
  input[type=text],input[type=url],textarea{width:100%;box-sizing:border-box;padding:6px;font:inherit}
  textarea{min-height:70px} fieldset{border:1px solid #ddd;border-radius:8px;margin:12px 0;background:#fff}
  .reels{max-height:260px;overflow:auto;border:1px solid #ddd;padding:6px;background:#fff}
  .reels label{font-weight:400;margin:2px 0}
</style></head><body>${NAV}${body}</body></html>`;
}

export function legalPage(kind: 'privacy' | 'terms' | 'data-deletion'): string {
  const pages = {
    privacy: {
      title: 'Política de privacidad',
      body: `<p>Esta aplicación la usa únicamente el titular de la cuenta de Instagram conectada para responder comentarios y mensajes directos que recibe su propia cuenta.</p>
<p>Datos que se tratan: el identificador de Instagram, el nombre de usuario y el texto de los comentarios o mensajes que la persona envía a esta cuenta. Se usan solo para responder y para hacer seguimiento comercial de esas conversaciones.</p>
<p>Los datos no se venden ni se ceden a terceros. Se guardan en una base de datos privada y solo el titular tiene acceso.</p>`,
    },
    terms: {
      title: 'Términos del servicio',
      body: `<p>Esta aplicación es de uso privado del titular de la cuenta de Instagram conectada. No se ofrece como servicio a terceros.</p>
<p>Las respuestas automáticas se envían solo a personas que han comentado o escrito primero a esta cuenta, respetando las normas de Instagram.</p>`,
    },
    'data-deletion': {
      title: 'Borrado de datos',
      body: `<p>Para pedir el borrado de tus datos (identificador, usuario y mensajes), envía un mensaje directo a la cuenta de Instagram con la palabra <strong>BORRAR</strong>.</p>
<p>Los datos se eliminarán en un plazo máximo de 30 días y te lo confirmaremos por el mismo canal.</p>`,
    },
  } as const;
  const page = pages[kind];
  return layout(page.title, `<h1>${page.title}</h1>${page.body}`);
}

export function contactsPage(contacts: readonly ContactRow[]): string {
  const rows = contacts
    .map(
      (contact) => `<tr><td>${contact.username ? `@${escapeHtml(contact.username)}` : '<small>(sin usuario)</small>'}<br><small>${escapeHtml(contact.igId)}</small></td>
<td>${contact.tags.map((tag) => `<span class="ok">${escapeHtml(tag)}</span>`).join(', ')}</td>
<td>${escapeHtml(contact.firstSeen.toISOString())}</td><td>${escapeHtml(contact.lastSeen.toISOString())}</td></tr>`,
    )
    .join('');
  return layout(
    'Contactos',
    `<h1>Contactos</h1><p>Personas que han comentado, pulsado un botón o escrito. Las etiquetas se añaden al pulsar enlaces con etiquetas.</p>
<table><tr><th>Persona</th><th>Etiquetas</th><th>Primera vez (UTC)</th><th>Última vez (UTC)</th></tr>${rows || '<tr><td colspan="4">Todavía no hay contactos.</td></tr>'}</table>`,
  );
}

export interface DashboardData {
  readonly account: Account | null;
  readonly accountError: string | null;
  readonly secretConfigured: boolean;
  readonly token: TokenStatus;
  readonly pausedUntil: string | null;
  readonly pauseReason: string | null;
  readonly sendsLastHour: number;
  readonly limitPerHour: number;
  readonly activeFlows: number;
  readonly totalFlows: number;
  readonly linkTracking: boolean;
  readonly events: readonly EventRow[];
  readonly actions: readonly ActionRow[];
  readonly flash: string | null;
}

function pauseBlock(data: DashboardData): string {
  if (!data.pausedUntil) return '<span class="ok">✔ Envíos activos</span>';
  return `<span class="bad">⏸ PAUSADO hasta ${escapeHtml(data.pausedUntil)}</span> — ${escapeHtml(data.pauseReason ?? '')}
  <form class="inline" method="post" action="/eventos/reanudar"><button>Reanudar ahora</button></form>`;
}

function tokenBlock(token: TokenStatus): string {
  const parts = [`origen: <strong>${escapeHtml(token.source)}</strong>`];
  if (token.expiresAt) parts.push(`caduca: ${escapeHtml(token.expiresAt)}`);
  if (token.refreshedAt) parts.push(`renovado: ${escapeHtml(token.refreshedAt)}`);
  if (!token.encryptionConfigured) parts.push('<span class="warn">sin TOKEN_ENCRYPTION_KEY → no se renueva solo</span>');
  if (token.lastError) parts.push(`<span class="bad">último error: ${escapeHtml(token.lastError)}</span>`);
  return parts.join(' · ');
}

export function dashboardPage(data: DashboardData): string {
  const account = data.account
    ? `<span class="ok">✔ @${escapeHtml(data.account.username)} (id ${escapeHtml(data.account.userId)})</span>`
    : `<span class="bad">✘ ${escapeHtml(data.accountError ?? 'Sin conectar')}</span>`;

  const events = data.events
    .map(
      (row) => `<tr><td>${escapeHtml(row.createdAt.toISOString())}</td><td>${escapeHtml(row.kind)}</td>
<td>${escapeHtml(row.note)}</td><td><pre>${jsonPreview(row.data)}</pre></td></tr>`,
    )
    .join('');
  const actions = data.actions
    .map(
      (row) => `<tr><td>${escapeHtml(row.createdAt.toISOString())}</td><td>${escapeHtml(row.type)}</td>
<td>${row.ok === null ? '<span class="warn">en curso</span>' : status(row.ok, 'OK', 'ERROR / OMITIDO')}</td>
<td><pre>${jsonPreview(row.response)}</pre></td></tr>`,
    )
    .join('');

  const body = `<h1>Setter IA — estado</h1>
${data.flash ? `<div class="card">${escapeHtml(data.flash)}</div>` : ''}
<div class="card">
  <div>Cuenta de Instagram: ${account}</div>
  <div>Token: ${tokenBlock(data.token)}</div>
  <div>App Secret (firma de avisos): ${status(data.secretConfigured, 'configurado', 'falta META_APP_SECRET')}</div>
  <div>Anti-ban: ${pauseBlock(data)} · envíos última hora: <strong>${data.sendsLastHour}</strong> / ${data.limitPerHour}</div>
  <div>Flujos: <strong>${data.activeFlows}</strong> activos de ${data.totalFlows} · <a href="/flujos">gestionar flujos</a></div>
  <div>Enlaces con seguimiento (clics + etiquetas): ${status(data.linkTracking, 'activos', 'desactivados (falta URL pública o TOKEN_ENCRYPTION_KEY)')}</div>
  <p><form class="inline" method="post" action="/eventos/suscribir"><button>Activar suscripción de la cuenta (comments + messages)</button></form>
  <form class="inline" method="post" action="/eventos/renovar-token"><button>Renovar token ahora</button></form>
  <a href="/eventos">↻ Recargar</a></p>
</div>
<h2>Acciones (envíos a Instagram)</h2>
<table><tr><th>Fecha (UTC)</th><th>Tipo</th><th>Estado</th><th>Respuesta de Meta</th></tr>${actions}</table>
<h2>Eventos recibidos</h2>
<table><tr><th>Fecha (UTC)</th><th>Tipo</th><th>Qué se hizo</th><th>Datos</th></tr>${events}</table>`;
  return layout('Setter IA — estado', body);
}
