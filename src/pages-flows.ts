import type { FlowForm } from './flows/form.js';
import type { Flow } from './flows/types.js';
import type { Media } from './meta/client.js';
import { escapeHtml, jsonPreview, layout } from './pages.js';

function reelLabel(media: readonly Media[], id: string): string {
  const item = media.find((candidate) => candidate.id === id);
  return item ? `${item.timestamp?.slice(0, 10) ?? ''} ${(item.caption ?? '').slice(0, 50)}` : id;
}

function triggerSummary(flow: Flow, media: readonly Media[]): string {
  const reels = flow.trigger.mediaIds === 'all' ? 'Todos los reels' : flow.trigger.mediaIds.map((id) => reelLabel(media, id)).join(' | ');
  const words = flow.trigger.keywords.length ? `palabras: ${flow.trigger.keywords.join(', ')}` : 'cualquier comentario';
  return `${escapeHtml(reels)}<br><small>${escapeHtml(words)}</small>`;
}

export function flowsListPage(flows: readonly Flow[], media: readonly Media[], flash: string | null): string {
  const rows = flows
    .map(
      (flow) => `<tr>
<td><strong>${escapeHtml(flow.name)}</strong><br><small>id ${escapeHtml(flow.id)}</small></td>
<td>${flow.enabled ? '<span class="ok">ACTIVO</span>' : '<span class="warn">inactivo</span>'}</td>
<td>${triggerSummary(flow, media)}</td>
<td>${flow.testUsernames.length ? `<span class="warn">PRUEBA: solo ${escapeHtml(flow.testUsernames.join(', '))}</span>` : 'todo el mundo'}</td>
<td>
  <a href="/flujos/${encodeURIComponent(flow.id)}">Editar</a>
  <form class="inline" method="post" action="/flujos/${encodeURIComponent(flow.id)}/activar"><input type="hidden" name="enabled" value="${flow.enabled ? 'false' : 'true'}"><button>${flow.enabled ? 'Desactivar' : 'Activar'}</button></form>
  <form class="inline" method="post" action="/flujos/${encodeURIComponent(flow.id)}/borrar" onsubmit="return confirm('¿Borrar este flujo?')"><button>Borrar</button></form>
</td></tr>`,
    )
    .join('');
  const body = `<h1>Flujos de comentarios</h1>
${flash ? `<div class="card">${escapeHtml(flash)}</div>` : ''}
<p>Cada flujo dice qué hacer cuando alguien comenta: respuesta pública + DM con botones (y, si quieres, condición de seguir).
Si dos flujos coinciden, gana el más específico (reel concreto y con palabras clave).</p>
<p><a href="/flujos/nuevo"><button>+ Nuevo flujo (formulario)</button></a> <a href="/flujos/nuevo-json"><button>+ Nuevo flujo avanzado (JSON)</button></a></p>
<table><tr><th>Nombre</th><th>Estado</th><th>Cuándo salta</th><th>A quién</th><th></th></tr>${rows || '<tr><td colspan="5">Todavía no hay flujos.</td></tr>'}</table>`;
  return layout('Flujos', body);
}

function input(name: keyof FlowForm, value: string, type = 'text'): string {
  return `<input type="${type}" name="${name}" value="${escapeHtml(value)}">`;
}

function checkbox(name: keyof FlowForm, checked: boolean, text: string): string {
  return `<label><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}> ${escapeHtml(text)}</label>`;
}

function reelsPicker(form: FlowForm, media: readonly Media[]): string {
  const items = media
    .map(
      (item) => `<label><input type="checkbox" name="mediaIds" value="${escapeHtml(item.id)}" ${form.mediaIds.includes(item.id) ? 'checked' : ''}>
${escapeHtml(item.timestamp?.slice(0, 10) ?? '')} · ${escapeHtml(item.mediaProductType ?? '')} · ${escapeHtml((item.caption ?? '').slice(0, 70))}</label>`,
    )
    .join('');
  const missing = form.mediaIds.filter((id) => !media.some((item) => item.id === id));
  const hidden = missing.map((id) => `<label><input type="checkbox" name="mediaIds" value="${escapeHtml(id)}" checked> ${escapeHtml(id)} (reel antiguo)</label>`).join('');
  return `<div class="reels">${hidden}${items || '<em>No se pudieron cargar los reels (¿token?).</em>'}</div>`;
}

export interface FlowFormPageData {
  readonly form: FlowForm;
  readonly media: readonly Media[];
  readonly errors: readonly string[];
  readonly isNew: boolean;
  readonly preview: Flow | null;
}

export function flowFormPage(data: FlowFormPageData): string {
  const { form, media, errors } = data;
  const action = data.isNew ? '/flujos/nuevo' : `/flujos/${encodeURIComponent(form.id)}`;
  const body = `<h1>${data.isNew ? 'Nuevo flujo' : `Editar flujo: ${escapeHtml(form.name)}`}</h1>
${errors.length ? `<div class="errors"><strong>Revisa esto:</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="${action}">
<input type="hidden" name="id" value="${escapeHtml(form.id)}">
<fieldset><legend>General</legend>
  <label>Nombre ${input('name', form.name)}</label>
  ${checkbox('enabled', form.enabled, 'Flujo activo')}
  <label>Modo prueba <small>— usuarios separados por comas (p. ej. josegomezlife). Si pones alguno, el flujo SOLO responde a ellos.</small>${input('testUsernames', form.testUsernames)}</label>
  ${checkbox('oncePerUser', form.oncePerUser, 'Una sola vez por persona (recomendado contra el spam)')}
</fieldset>
<fieldset><legend>Cuándo salta</legend>
  ${checkbox('allMedia', form.allMedia, 'Todos los reels y publicaciones')}
  <label>O elige reels concretos:</label>${reelsPicker(form, media)}
  <label>Palabras clave <small>— separadas por comas. Vacío = cualquier comentario. No distingue mayúsculas ni tildes.</small>${input('keywords', form.keywords)}</label>
</fieldset>
<fieldset><legend>Respuesta pública al comentario</legend>
  <label>Una por línea <small>— se elige una al azar (variar evita parecer spam). Vacío = sin respuesta pública.</small>
  <textarea name="publicReplies">${escapeHtml(form.publicReplies)}</textarea></label>
</fieldset>
<fieldset><legend>DM</legend>
  <label>Primer mensaje (el DM al comentario)<textarea name="startText">${escapeHtml(form.startText)}</textarea></label>
  <label><input type="radio" name="mode" value="link" ${form.mode === 'link' ? 'checked' : ''}> Enlace directo (un botón que abre el recurso)</label>
  <label><input type="radio" name="mode" value="follow" ${form.mode === 'follow' ? 'checked' : ''}> Condición de seguir (solo entrega el recurso si te sigue)</label>
  <fieldset><legend>Si eliges "Enlace directo"</legend>
    <label>Texto del botón ${input('linkTitle', form.linkTitle)}</label>
    <label>URL del recurso ${input('linkUrl', form.linkUrl, 'url')}</label>
  </fieldset>
  <fieldset><legend>Si eliges "Condición de seguir"</legend>
    <label>Botón del primer mensaje ${input('startButtonTitle', form.startButtonTitle)}</label>
    <label>Mensaje con el recurso (si te sigue)<textarea name="resourceText">${escapeHtml(form.resourceText)}</textarea></label>
    <label>Texto del botón del recurso ${input('resourceButtonTitle', form.resourceButtonTitle)}</label>
    <label>URL del recurso ${input('resourceUrl', form.resourceUrl, 'url')}</label>
    <label>Mensaje si NO te sigue<textarea name="notFollowingText">${escapeHtml(form.notFollowingText)}</textarea></label>
    <label>Botón para reintentar ${input('retryButtonTitle', form.retryButtonTitle)}</label>
    <p><small>Si Meta no deja saber si te sigue (falta de "consentimiento"), se entrega el recurso igualmente y queda registrado.</small></p>
  </fieldset>
</fieldset>
<p><button type="submit">Guardar flujo</button> <a href="/flujos">Cancelar</a></p>
</form>
${data.preview ? `<h2>Cómo queda guardado (formato de nodos)</h2><pre>${jsonPreview(data.preview)}</pre>` : ''}`;
  return layout(data.isNew ? 'Nuevo flujo' : 'Editar flujo', body);
}

export interface FlowJsonPageData {
  readonly json: string;
  readonly errors: readonly string[];
  /** null = flujo nuevo */
  readonly flowId: string | null;
  readonly media: readonly Media[];
}

/** Editor JSON para flujos avanzados (pausas, etiquetas, varios pasos) hasta que exista el constructor visual (Fase 6). */
export function flowJsonPage(data: FlowJsonPageData): string {
  const action = data.flowId ? `/flujos/${encodeURIComponent(data.flowId)}/json` : '/flujos/nuevo-json';
  const reels = data.media
    .map((item) => `<li><code>${escapeHtml(item.id)}</code> · ${escapeHtml(item.timestamp?.slice(0, 10) ?? '')} · ${escapeHtml((item.caption ?? '').slice(0, 70))}</li>`)
    .join('');
  const body = `<h1>${data.flowId ? 'Editar flujo avanzado' : 'Nuevo flujo avanzado'} (JSON)</h1>
<p>Para flujos con pausas, etiquetas o varios pasos. El constructor visual (Fase 6) editará este mismo formato.</p>
${data.errors.length ? `<div class="errors"><strong>Revisa esto:</strong><ul>${data.errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul></div>` : ''}
<form method="post" action="${action}">
  <textarea name="json" style="min-height:480px;font-family:monospace;font-size:.8rem">${escapeHtml(data.json)}</textarea>
  <p><button type="submit">Validar y guardar</button> <a href="/flujos">Cancelar</a></p>
</form>
<details><summary>IDs de tus reels recientes</summary><ul>${reels}</ul></details>
<details><summary>Tipos de paso</summary><pre>${escapeHtml(`message:     { id, type:"message", text, buttons:[...], next?: "otro_paso" }
  botón enlace: { type:"url", title, url, tags?: ["etiqueta"] }   ← añade etiquetas al pulsar
  botón acción: { type:"postback", title, next: "otro_paso" }
follow_gate: { id, type:"follow_gate", ifFollowing, ifNotFollowing, ifUnknown }
delay:       { id, type:"delay", seconds: 120, next: "otro_paso" }   ← máx. 23 h`)}</pre></details>`;
  return layout(data.flowId ? 'Editar flujo avanzado' : 'Nuevo flujo avanzado', body);
}
