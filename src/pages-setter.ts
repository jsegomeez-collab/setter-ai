import { escapeHtml, jsonPreview, layout } from './pages.js';
import type { Scenario } from './setter/scenarios.js';
import { LeadSchema } from './setter/schema.js';
import { estimateCostUsd, verdict, type SimulationResult } from './setter/simulator.js';
import { trailingDrafts, type SetterMode } from './setter/service.js';
import type { ContactRow, ConversationRow, KnowledgeRow, LeadHistoryRow, MessageRow } from './store.js';

/** Páginas del setter IA: /setter (ajustes + documento) y /conversaciones (lista, hilo, ficha, pausa). */

const flashBox = (flash: string | null) => (flash ? `<div class="card">${escapeHtml(flash)}</div>` : '');
const when = (date: Date) => escapeHtml(date.toISOString().replace('T', ' ').slice(0, 16));

export interface SetterPageData {
  readonly mode: SetterMode;
  readonly draft: boolean;
  readonly testUsernames: readonly string[];
  readonly apiKeyConfigured: boolean;
  readonly model: string;
  readonly knowledge: KnowledgeRow | null;
  readonly versions: readonly KnowledgeRow[];
  readonly flash: string | null;
}

/** Avisos sobre el documento: huecos sin confirmar y enlaces que el código sustituye. */
export function knowledgeWarnings(text: string): string[] {
  const gaps = text.match(/\[(CONFIRMAR|COMPLETAR)[^\]]*\]/gi) ?? [];
  const warnings = gaps.length > 0 ? [`${gaps.length} hueco(s) sin confirmar ([CONFIRMAR…]/[COMPLETAR]): la IA no los afirma, deriva a la llamada o al correo.`] : [];
  if (!text.includes('[LINK AGENDA]')) warnings.push('No aparece [LINK AGENDA]: la IA tiene el enlace igualmente (va en las instrucciones técnicas).');
  if (!text.includes('[LINK MEMBRESÍA]')) warnings.push('No aparece [LINK MEMBRESÍA]: la IA tiene el enlace igualmente (va en las instrucciones técnicas).');
  return warnings;
}

const MODE_LABELS: Record<SetterMode, string> = {
  off: 'Apagado (guarda los DMs, no responde)',
  test: 'Prueba (solo los usuarios de la lista)',
  live: 'Público (responde a todo el mundo)',
};

function settingsForm(data: SetterPageData): string {
  const options = (Object.keys(MODE_LABELS) as SetterMode[])
    .map((mode) => `<label><input type="radio" name="mode" value="${mode}"${data.mode === mode ? ' checked' : ''}> ${escapeHtml(MODE_LABELS[mode])}</label>`)
    .join('');
  return `<form method="post" action="/setter/ajustes" onsubmit="return this.mode.value !== 'live' || confirm('¿Activar el setter para TODO el mundo?')">
<fieldset><legend>Modo</legend>${options}</fieldset>
<label><input type="checkbox" name="draft" value="true"${data.draft ? ' checked' : ''}> Modo borrador <small>(la IA escribe pero no envía: lo ves en Conversaciones)</small></label>
<label>Usuarios de prueba <small>(usernames de Instagram separados por comas)</small></label>
<input type="text" name="testUsernames" value="${escapeHtml(data.testUsernames.join(', '))}">
<p><button type="submit">Guardar ajustes</button></p></form>`;
}

function knowledgeForm(data: SetterPageData): string {
  const text = data.knowledge?.text ?? '';
  const warnings = knowledgeWarnings(text);
  const info = data.knowledge ? `Versión #${data.knowledge.id} del ${when(data.knowledge.createdAt)} · ${text.length} caracteres` : '<span class="bad">Sin documento: la IA no responde hasta que lo cargues.</span>';
  return `<p>${info}</p>
${warnings.length ? `<div class="errors">${warnings.map((w) => `<div>⚠ ${escapeHtml(w)}</div>`).join('')}</div>` : ''}
<form method="post" action="/setter/documento"><textarea name="text" style="min-height:420px">${escapeHtml(text)}</textarea>
<p><button type="submit">Guardar como versión nueva</button></p></form>`;
}

function versionsTable(versions: readonly KnowledgeRow[], currentId: number | null): string {
  const rows = versions
    .map(
      (v) => `<tr><td>#${v.id}</td><td>${when(v.createdAt)}</td><td>${v.text.length} caracteres</td><td>${
        v.id === currentId
          ? '<span class="ok">EN USO</span>'
          : `<form class="inline" method="post" action="/setter/documento/${v.id}/restaurar"><button>Restaurar</button></form>`
      }</td></tr>`,
    )
    .join('');
  return `<table><tr><th>Versión</th><th>Fecha</th><th>Tamaño</th><th></th></tr>${rows || '<tr><td colspan="4">Sin versiones.</td></tr>'}</table>`;
}

const simButton = (id: string, label: string) =>
  `<form class="inline" method="post" action="/setter/simulador/${encodeURIComponent(id)}" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Simulando… (hasta 1 min)'"><button>${escapeHtml(label)}</button></form>`;

export function simulatorPage(scenarios: readonly Scenario[], available: string | null): string {
  const rows = scenarios
    .map((s) => `<tr><td>${escapeHtml(s.group)}</td><td><strong>${escapeHtml(s.title)}</strong><br><small>${escapeHtml(s.persona)}</small></td><td><small>${escapeHtml(s.check)}</small></td><td>${simButton(s.id, 'Simular')}</td></tr>`)
    .join('');
  const custom = `<form method="post" action="/setter/simulador/personalizado" onsubmit="this.querySelector('button').disabled=true;this.querySelector('button').textContent='Simulando… (hasta 1 min)'">
<label>Perfil a tu gusto <small>(quién es, qué quiere, qué objeciones pone)</small></label><textarea name="persona" maxlength="2000"></textarea>
<p><button type="submit">Simular este perfil</button></p></form>`;
  const body = `<h1>Simulador del setter</h1>
<div class="card">Otra IA hace de lead con el perfil y el setter responde con <strong>tu documento y las reglas reales</strong>. No se envía nada a Instagram ni se guarda como conversación. Hasta 6 turnos (≈0,005 $ por simulación).</div>
${available ? `<div class="errors">${escapeHtml(available)}</div>` : ''}
${custom}<h2>Escenarios</h2><table><tr><th>Grupo</th><th>Perfil</th><th>Qué debería pasar</th><th></th></tr>${rows}</table>`;
  return layout('Simulador', body);
}

export function simulationResultPage(scenario: Pick<Scenario, 'title' | 'persona' | 'check' | 'expectStep' | 'expectStop'>, result: SimulationResult): string {
  const auto = verdict(scenario, result);
  const thread = result.turns
    .map((t) => {
      const who = t.who === 'lead' ? '⬅ Lead (simulado)' : '➡ Setter IA';
      const texts = t.texts.length ? t.texts.map((x) => `<div>${escapeHtml(x)}</div>`).join('') : '<em>(sin mensaje)</em>';
      return `<tr><td>${who}</td><td>${texts}${t.note ? `<small class="bad">${escapeHtml(t.note)}</small>` : ''}</td></tr>`;
    })
    .join('');
  const body = `<p><a href="/setter/simulador">← Simulador</a></p><h1>${escapeHtml(scenario.title)}</h1>
<div class="card"><small>${escapeHtml(scenario.persona)}</small></div>
<div class="card"><strong>Qué debería pasar:</strong> ${escapeHtml(scenario.check)}<br>
${auto ? `<strong>Comprobación automática:</strong> <span class="${auto.ok ? 'ok' : 'bad'}">${escapeHtml(auto.detail)}</span><br>` : ''}
<strong>Final:</strong> ${escapeHtml(result.endReason)} · <strong>Coste estimado del setter:</strong> ${estimateCostUsd(result.usage).toFixed(4)} $</div>
<h2>Conversación</h2><table>${thread}</table>
<h2>Ficha final</h2>${leadTable(result.lead)}`;
  return layout(`Simulación: ${scenario.title}`, body);
}

export function setterPage(data: SetterPageData): string {
  const key = data.apiKeyConfigured ? '<span class="ok">✔ ANTHROPIC_API_KEY configurada</span>' : '<span class="bad">✘ Falta ANTHROPIC_API_KEY en Render: la IA no responde</span>';
  const body = `<h1>Setter IA</h1>${flashBox(data.flash)}
<div class="card">${key} · Modelo: <strong>${escapeHtml(data.model)}</strong> · Modo: <strong>${escapeHtml(MODE_LABELS[data.mode])}</strong>${data.draft ? ' · <span class="warn">BORRADOR</span>' : ''}</div>
<p><a href="/setter/simulador"><button>🧪 Simulador de conversaciones</button></a></p>
<h2>Ajustes</h2>${settingsForm(data)}
<h2>Documento del setter</h2>${knowledgeForm(data)}
<h2>Versiones anteriores</h2>${versionsTable(data.versions, data.knowledge?.id ?? null)}`;
  return layout('Setter IA', body);
}

const STATUS_LABELS: Record<MessageRow['status'], string> = {
  sent: '',
  queued: '<span class="warn">en cola</span>',
  held: '<span class="bad">RETENIDO (no enviado)</span>',
  failed: '<span class="bad">FALLÓ el envío</span>',
  discarded: '<span class="warn">DESCARTADO</span>',
};
const SOURCE_LABELS: Record<MessageRow['source'], string> = { user: 'Persona', flow: 'Flujo', ai: 'IA', human: 'Jose (a mano)' };

function nextStep(lead: unknown): string {
  const parsed = LeadSchema.safeParse(lead);
  return parsed.success ? escapeHtml(parsed.data.siguiente_paso) : '—';
}

export function conversationsPage(rows: readonly ConversationRow[], flash: string | null): string {
  const list = rows
    .map(
      (r) => `<tr><td><a href="/conversaciones/${encodeURIComponent(r.igId)}">${r.username ? `@${escapeHtml(r.username)}` : escapeHtml(r.igId)}</a></td>
<td>${when(r.lastAt)}</td><td>${r.lastDirection === 'in' ? '⬅' : '➡'} ${escapeHtml(r.lastText.slice(0, 120))}</td>
<td>${r.aiPaused ? '<span class="bad">IA parada</span>' : '<span class="ok">IA activa</span>'}</td><td>${nextStep(r.lead)}</td></tr>`,
    )
    .join('');
  const body = `<h1>Conversaciones</h1>${flashBox(flash)}
<table><tr><th>Persona</th><th>Último mensaje</th><th></th><th>IA</th><th>Siguiente paso</th></tr>${list || '<tr><td colspan="5">Todavía no hay conversaciones.</td></tr>'}</table>`;
  return layout('Conversaciones', body);
}

function leadTable(lead: unknown): string {
  if (lead === null || lead === undefined) return '<p>Sin ficha todavía.</p>';
  const parsed = LeadSchema.safeParse(lead);
  if (!parsed.success) return `<pre>${jsonPreview(lead)}</pre>`;
  const rows = Object.entries(parsed.data)
    .map(([field, value]) => `<tr><th>${escapeHtml(field)}</th><td>${escapeHtml(Array.isArray(value) ? value.join(' · ') || '—' : value ?? '—')}</td></tr>`)
    .join('');
  return `<table>${rows}</table>`;
}

export interface ConversationPageData {
  readonly igId: string;
  readonly contact: ContactRow | null;
  readonly messages: readonly MessageRow[];
  /** Cada cambio de la ficha, del más antiguo al más nuevo (Fase 4). */
  readonly leadHistory: readonly LeadHistoryRow[];
  readonly flash: string | null;
}

/** Borrador pendiente (modo borrador): lo que diría la IA, con Enviar / Descartar. */
function draftCard(id: string, messages: readonly MessageRow[]): string {
  const drafts = trailingDrafts(messages);
  if (drafts.length === 0) return '';
  const texts = drafts.map((m) => `<li>${escapeHtml(m.text)}</li>`).join('');
  return `<div class="card"><strong>Borrador pendiente</strong> (la IA lo escribió pero no lo ha enviado):<ol>${texts}</ol>
<form class="inline" method="post" action="/conversaciones/${id}/borrador/enviar"><button>Enviar tal cual</button></form>
<form class="inline" method="post" action="/conversaciones/${id}/borrador/descartar"><button>Descartar</button></form></div>`;
}

/** Lo que más dice del avance: etapa, nivel, si puede invertir y el resumen. */
function leadHistoryTable(history: readonly LeadHistoryRow[]): string {
  if (history.length === 0) return '<p>Sin cambios guardados todavía.</p>';
  const field = (lead: unknown, key: string) => {
    const value = (lead as Record<string, unknown> | null)?.[key];
    return typeof value === 'string' ? escapeHtml(value) : '—';
  };
  const rows = history
    .map(
      (h) => `<tr><td>${when(h.createdAt)}</td><td>${field(h.lead, 'siguiente_paso')}</td><td>${field(h.lead, 'nivel')}</td>
<td>${field(h.lead, 'puede_invertir')}</td><td><small>${field(h.lead, 'resumen')}</small></td></tr>`,
    )
    .join('');
  return `<table><tr><th>Fecha</th><th>Siguiente paso</th><th>Nivel</th><th>Puede invertir</th><th>Resumen</th></tr>${rows}</table>`;
}

export function conversationPage(data: ConversationPageData): string {
  const { contact } = data;
  const id = encodeURIComponent(data.igId);
  const name = contact?.username ? `@${contact.username}` : data.igId;
  const pause = contact?.aiPaused
    ? `<span class="bad">IA parada</span>: ${escapeHtml(contact.aiPausedReason ?? 'sin motivo')}
<form class="inline" method="post" action="/conversaciones/${id}/reanudar"><button>Reanudar la IA</button></form>`
    : `<span class="ok">IA activa</span> <form class="inline" method="post" action="/conversaciones/${id}/pausar"><button>Parar la IA aquí</button></form>`;
  const thread = data.messages
    .map(
      (m) => `<tr><td>${when(m.createdAt)}</td><td>${m.direction === 'in' ? '⬅' : '➡'} ${escapeHtml(SOURCE_LABELS[m.source])}</td>
<td>${escapeHtml(m.text)}${m.note ? `<br><small>${escapeHtml(m.note)}</small>` : ''}</td><td>${STATUS_LABELS[m.status]}</td></tr>`,
    )
    .join('');
  const body = `<p><a href="/conversaciones">← Conversaciones</a></p><h1>${escapeHtml(name)}</h1>${flashBox(data.flash)}
<div class="card">${pause}</div>
${draftCard(id, data.messages)}
<h2>Ficha</h2>${leadTable(contact?.lead)}
<h2>Historial de la ficha</h2><p><small>Una fila cada vez que la IA cambió algo de la ficha.</small></p>${leadHistoryTable(data.leadHistory)}
<h2>Mensajes</h2><table><tr><th>Fecha</th><th>De</th><th>Texto</th><th></th></tr>${thread || '<tr><td colspan="4">Sin mensajes.</td></tr>'}</table>`;
  return layout(`Conversación ${name}`, body);
}
