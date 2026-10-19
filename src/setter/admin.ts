import { MAX_DELAY_SECONDS, flowSchema, type Flow } from '../flows/types.js';
import { SETTINGS, type KnowledgeKind, type KnowledgeRow, type Store } from '../store.js';
import { DEFAULT_FRAME } from './prompt.js';
import { parseUsernames, type SetterMode } from './service.js';

/**
 * Lo que el admin cambia del setter desde el frontend (Fase 6.1): documento y marco técnico (con versiones),
 * modo y usuarios de prueba, y los textos de inicio + la espera del flujo. Todo queda en el registro de eventos.
 */

export const MAX_DOCUMENT_CHARS = 60_000;
export const MAX_FRAME_CHARS = 20_000;
export const VERSIONS_LIMIT = 30;
export const SETTER_MODES: readonly SetterMode[] = ['off', 'test', 'live'];

const LABELS: Record<KnowledgeKind, string> = { document: 'Documento del setter', frame: 'Marco técnico del setter' };
const DEFAULT_FRAME_TEXT = DEFAULT_FRAME.trim();
const PREVIEW_CHARS = 140;

export type AdminResult =
  | { readonly ok: true; readonly id?: number; readonly unchanged?: boolean }
  | { readonly ok: false; readonly status: 400 | 404; readonly error: string };

const normalize = (text: string): string => text.replace(/\r\n/g, '\n').trim();
const isDefaultFrame = (text: string): boolean => text.trim() === '' || text.trim() === DEFAULT_FRAME_TEXT;

/** Guarda una versión nueva solo si cambia algo (si no, no llena el historial de copias). */
async function saveIfChanged(store: Store, kind: KnowledgeKind, text: string, message: string): Promise<AdminResult> {
  const current = await store.getKnowledge(kind);
  if (current && current.text === text) return { ok: true, id: current.id, unchanged: true };
  const id = await store.saveKnowledge(text, kind);
  await store.logEvent('setter', `${message} (versión #${id}).`, { id, kind, chars: text.length });
  return { ok: true, id };
}

export async function saveVersion(store: Store, kind: KnowledgeKind, raw: string): Promise<AdminResult> {
  const text = normalize(raw);
  if (!text) {
    const error = kind === 'frame' ? 'El marco está vacío. Para volver al original usa "Volver al original".' : 'El documento está vacío: no se guarda.';
    return { ok: false, status: 400, error };
  }
  const max = kind === 'frame' ? MAX_FRAME_CHARS : MAX_DOCUMENT_CHARS;
  if (text.length > max) return { ok: false, status: 400, error: `Demasiado largo (máximo ${max.toLocaleString('es')} caracteres).` };
  // Guardar el marco original tal cual = volver al original (no deja una copia que luego no se actualizaría).
  if (kind === 'frame' && isDefaultFrame(text)) return resetFrame(store);
  return saveIfChanged(store, kind, text, `${LABELS[kind]} guardado`);
}

export async function restoreVersion(store: Store, kind: KnowledgeKind, wanted: number): Promise<AdminResult> {
  const version = (await store.listKnowledgeVersions(VERSIONS_LIMIT, kind)).find((v) => v.id === wanted);
  if (!version) return { ok: false, status: 404, error: 'Esa versión no existe (o es muy antigua).' };
  return saveIfChanged(store, kind, version.text, `${LABELS[kind]}: restaurada la versión #${wanted}`);
}

/** "Volver al original": versión vacía = se usa DEFAULT_FRAME (y así queda en el historial). */
export async function resetFrame(store: Store): Promise<AdminResult> {
  const current = await store.getKnowledge('frame');
  if (!current || isDefaultFrame(current.text)) return { ok: true, id: current?.id, unchanged: true };
  return saveIfChanged(store, 'frame', '', 'Marco técnico: vuelta al original');
}

export function frameView(row: KnowledgeRow | null): { id: number | null; text: string; isDefault: boolean } {
  const isDefault = !row || isDefaultFrame(row.text);
  return { id: row?.id ?? null, text: isDefault || !row ? DEFAULT_FRAME_TEXT : row.text, isDefault };
}

export function versionSummary(row: KnowledgeRow, kind: KnowledgeKind) {
  const isDefault = kind === 'frame' && isDefaultFrame(row.text);
  const preview = isDefault ? 'Original' : row.text.replace(/\s+/g, ' ').slice(0, PREVIEW_CHARS);
  return { id: row.id, createdAt: row.createdAt, chars: row.text.length, preview, isDefault };
}

export async function saveSettings(store: Store, input: { mode: string; draft: boolean; testUsernames: readonly string[] }): Promise<AdminResult> {
  const mode = input.mode as SetterMode;
  if (!SETTER_MODES.includes(mode)) return { ok: false, status: 400, error: 'Modo no válido.' };
  const usernames = parseUsernames(input.testUsernames.join(','));
  await store.setSetting(SETTINGS.setterMode, mode);
  await store.setSetting(SETTINGS.setterDraft, input.draft ? 'true' : 'false');
  await store.setSetting(SETTINGS.setterTestUsernames, usernames.join(','));
  await store.logEvent('setter', `Ajustes del setter: modo ${mode}${input.draft ? ' (borrador)' : ''}.`, { mode, usernames });
  return { ok: true };
}

export interface OpenerStep {
  readonly flowId: string;
  readonly flowName: string;
  readonly nodeId: string;
  readonly texts: readonly string[];
  /** La espera que va justo antes (null si el inicio no tiene espera delante). */
  readonly delayNodeId: string | null;
  readonly delaySeconds: number | null;
}

/** Pasos "inicio del setter" de todos los flujos, con la espera que los precede. */
export function findOpeners(flows: readonly Flow[]): OpenerStep[] {
  return flows.flatMap((flow) =>
    flow.nodes.flatMap((node) => {
      if (node.type !== 'setter_opener') return [];
      const delay = flow.nodes.find((n) => n.type === 'delay' && n.next === node.id);
      const delaySeconds = delay?.type === 'delay' ? delay.seconds : null;
      return [{ flowId: flow.id, flowName: flow.name, nodeId: node.id, texts: node.texts, delayNodeId: delay?.id ?? null, delaySeconds }];
    }),
  );
}

export async function updateOpener(
  store: Store,
  input: { flowId: string; nodeId: string; texts: readonly string[]; delaySeconds?: number },
): Promise<AdminResult> {
  const flow = (await store.listFlows()).find((f) => f.id === input.flowId);
  const step = flow ? findOpeners([flow]).find((s) => s.nodeId === input.nodeId) : undefined;
  if (!flow || !step) return { ok: false, status: 404, error: 'No encuentro ese paso de inicio del setter.' };
  const texts = input.texts.map((t) => t.trim()).filter((t) => t.length > 0);
  const nodes = flow.nodes.map((node) => {
    if (node.id === step.nodeId && node.type === 'setter_opener') return { ...node, texts };
    if (node.id === step.delayNodeId && node.type === 'delay' && input.delaySeconds !== undefined) return { ...node, seconds: input.delaySeconds };
    return node;
  });
  const parsed = flowSchema.safeParse({ ...flow, nodes });
  if (!parsed.success) {
    return { ok: false, status: 400, error: `Revisa los datos: entre 1 y 20 textos y una espera de 1 segundo a ${MAX_DELAY_SECONDS / 3600} horas.` };
  }
  await store.saveFlow(parsed.data);
  await store.logEvent('setter', `Inicio del setter cambiado en "${flow.name}": ${texts.length} texto(s), espera ${input.delaySeconds ?? step.delaySeconds ?? '—'} s.`, {
    flowId: flow.id,
    nodeId: step.nodeId,
  });
  return { ok: true };
}
