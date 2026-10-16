import type { Account, Media } from './meta/client.js';
import type { ActionRow, EventRow } from './store.js';

const MAX_JSON_PREVIEW = 1500;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;color:#1a1a1a;background:#fafafa}
  h1{font-size:1.4rem} h2{font-size:1.1rem;margin-top:28px}
  table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}
  th,td{border:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}
  pre{white-space:pre-wrap;word-break:break-all;margin:0;font-size:.75rem;max-height:160px;overflow:auto}
  .ok{color:#137333;font-weight:600} .bad{color:#b3261e;font-weight:600} .warn{color:#8a5a00;font-weight:600}
  .card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0}
  button{cursor:pointer;padding:6px 10px} form{display:inline}
</style></head><body>${body}</body></html>`;
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

export interface DashboardData {
  readonly account: Account | null;
  readonly accountError: string | null;
  readonly tokenConfigured: boolean;
  readonly secretConfigured: boolean;
  readonly testMediaId: string | null;
  readonly dmRepliesEnabled: boolean;
  readonly allowedSenders: readonly string[];
  readonly media: readonly Media[];
  readonly events: readonly EventRow[];
  readonly actions: readonly ActionRow[];
  readonly flash: string | null;
}

function json(value: unknown): string {
  const text = JSON.stringify(value, null, 1) ?? '';
  return escapeHtml(text.length > MAX_JSON_PREVIEW ? `${text.slice(0, MAX_JSON_PREVIEW)}…` : text);
}

function status(ok: boolean, yes: string, no: string): string {
  return ok ? `<span class="ok">✔ ${escapeHtml(yes)}</span>` : `<span class="bad">✘ ${escapeHtml(no)}</span>`;
}

function mediaSection(data: DashboardData): string {
  if (data.media.length === 0) return '<p class="warn">No hay reels para mostrar (¿falta el token?).</p>';
  const rows = data.media
    .map((item) => {
      const selected = item.id === data.testMediaId;
      const caption = (item.caption ?? '').slice(0, 80);
      return `<tr><td>${selected ? '<span class="ok">● PRUEBA</span>' : ''}</td>
<td>${escapeHtml(item.timestamp?.slice(0, 10))}</td><td>${escapeHtml(item.mediaProductType)}</td>
<td>${escapeHtml(caption)}</td>
<td>${item.permalink ? `<a href="${escapeHtml(item.permalink)}" target="_blank" rel="noopener">ver</a>` : ''}</td>
<td><form method="post" action="/eventos/reel-prueba"><input type="hidden" name="mediaId" value="${escapeHtml(item.id)}">
<button>Usar como reel de prueba</button></form></td></tr>`;
    })
    .join('');
  return `<table><tr><th></th><th>Fecha</th><th>Tipo</th><th>Texto</th><th></th><th></th></tr>${rows}</table>`;
}

export function dashboardPage(data: DashboardData): string {
  const account = data.account
    ? `<span class="ok">✔ @${escapeHtml(data.account.username)} (id ${escapeHtml(data.account.userId)})</span>`
    : `<span class="bad">✘ ${escapeHtml(data.accountError ?? 'Sin conectar')}</span>`;

  const events = data.events
    .map(
      (row) => `<tr><td>${escapeHtml(row.createdAt.toISOString())}</td><td>${escapeHtml(row.kind)}</td>
<td>${escapeHtml(row.note)}</td><td><pre>${json(row.data)}</pre></td></tr>`,
    )
    .join('');
  const actions = data.actions
    .map(
      (row) => `<tr><td>${escapeHtml(row.createdAt.toISOString())}</td><td>${escapeHtml(row.type)}</td>
<td>${row.ok === null ? '<span class="warn">en curso</span>' : status(row.ok, 'OK', 'ERROR')}</td>
<td><pre>${json(row.response)}</pre></td></tr>`,
    )
    .join('');

  const body = `<h1>Setter IA — Fase 1 (prueba sin IA)</h1>
${data.flash ? `<div class="card">${escapeHtml(data.flash)}</div>` : ''}
<div class="card">
  <div>Cuenta de Instagram: ${account}</div>
  <div>Token de Instagram: ${status(data.tokenConfigured, 'configurado', 'falta IG_ACCESS_TOKEN')}</div>
  <div>App Secret (firma de avisos): ${status(data.secretConfigured, 'configurado', 'falta META_APP_SECRET')}</div>
  <div>Reel de prueba: ${data.testMediaId ? `<span class="ok">${escapeHtml(data.testMediaId)}</span>` : '<span class="warn">ninguno (no se responde a ningún comentario)</span>'}</div>
  <div>Respuestas por DM: ${data.dmRepliesEnabled ? '<span class="ok">ACTIVADAS</span>' : '<span class="warn">desactivadas</span>'}
    <form method="post" action="/eventos/dms"><input type="hidden" name="enabled" value="${data.dmRepliesEnabled ? 'false' : 'true'}">
    <button>${data.dmRepliesEnabled ? 'Desactivar' : 'Activar'}</button></form></div>
  <div>Remitentes autorizados: ${data.allowedSenders.length > 0 ? escapeHtml(data.allowedSenders.join(', ')) : 'ninguno'}</div>
  <p><form method="post" action="/eventos/suscribir"><button>Activar suscripción de la cuenta (comments + messages)</button></form>
  <a href="/eventos">↻ Recargar</a></p>
</div>
<h2>Reels recientes</h2>${mediaSection(data)}
<h2>Acciones (envíos a Instagram)</h2>
<table><tr><th>Fecha (UTC)</th><th>Tipo</th><th>Estado</th><th>Respuesta de Meta</th></tr>${actions}</table>
<h2>Eventos recibidos</h2>
<table><tr><th>Fecha (UTC)</th><th>Tipo</th><th>Qué se hizo</th><th>Datos</th></tr>${events}</table>`;
  return layout('Setter IA — eventos', body);
}
