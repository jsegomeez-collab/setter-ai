import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireUser, type ApiEnv } from './routes-api.js';
import { BASE_DOCS, docKind, slugify } from './setter/knowledge-docs.js';
import { loadKnowledge } from './setter/knowledge-source.js';
import { SETTINGS, type Store } from './store.js';
import type { KnowledgeDocRow } from './store-docs.js';
import type { UserStore } from './users.js';

/**
 * Documentos del setter por tema (Fase 7.2), solo admin. Decisión de Jose: lista base + poder crear más. La IA sigue
 * con el documento único hasta que Jose pulse "Usar documentos separados" (modo 'docs'); se puede volver atrás.
 */

export interface SetterDocsApiDeps {
  readonly store: Store;
  readonly users: UserStore;
}

const MAX_DOC_CHARS = 30_000;
const MAX_TITLE = 60;
const VERSIONS_SHOWN = 15;

const textSchema = z.object({ text: z.string().max(MAX_DOC_CHARS) });
const titleSchema = z.object({ title: z.string().trim().min(1).max(MAX_TITLE) });
const metaSchema = z.object({ title: z.string().trim().min(1).max(MAX_TITLE).optional(), active: z.boolean().optional() });
const moveSchema = z.object({ dir: z.enum(['up', 'down']) });
const restoreSchema = z.object({ versionId: z.number().int() });
const modeSchema = z.object({ mode: z.enum(['docs', 'single']) });

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

export function createSetterDocsApi(deps: SetterDocsApiDeps): Hono<ApiEnv> {
  const { store } = deps;
  const api = new Hono<ApiEnv>();
  api.use('*', requireUser(deps.users), requireAdmin);

  /** La lista base aparece sola la primera vez (vacía y activa); lo que ya exista no se toca. */
  const ensureBaseDocs = async (): Promise<KnowledgeDocRow[]> => {
    const current = await store.listKnowledgeDocs();
    const missing = BASE_DOCS.filter((base) => !current.some((doc) => doc.slug === base.slug));
    if (missing.length === 0) return current;
    for (const base of missing) {
      await store.saveKnowledgeDoc({ slug: base.slug, title: base.title, position: BASE_DOCS.indexOf(base) + 1, active: true, builtin: true });
    }
    return store.listKnowledgeDocs();
  };

  const findDoc = async (slug: string) => (await ensureBaseDocs()).find((doc) => doc.slug === slug);
  const who = (c: Context<ApiEnv>) => c.get('user').name;

  api.get('/', async (c) => {
    const docs = await ensureBaseDocs();
    const [mode, single, versions] = await Promise.all([
      store.getSetting(SETTINGS.knowledgeMode),
      store.getKnowledge(),
      Promise.all(docs.map((doc) => store.listKnowledgeVersions(VERSIONS_SHOWN, docKind(doc.slug)))),
    ]);
    return c.json({
      mode: mode === 'docs' ? 'docs' : 'single',
      single: single ? { chars: single.text.length, updatedAt: single.createdAt } : null,
      docs: docs.map((doc, i) => ({
        ...doc,
        hint: BASE_DOCS.find((base) => base.slug === doc.slug)?.hint ?? 'Documento propio: lo que quieras que la IA sepa de este tema.',
        text: versions[i]?.[0]?.text ?? '',
        updatedAt: versions[i]?.[0]?.createdAt ?? null,
        versions: (versions[i] ?? []).map((v) => ({ id: v.id, createdAt: v.createdAt, chars: v.text.length })),
      })),
    });
  });

  api.post('/mode', async (c) => {
    const parsed = modeSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Modo no válido.' }, 400);
    if (parsed.data.mode === 'docs') {
      const preview = await loadKnowledge({ ...store, getSetting: async () => 'docs' });
      if (!preview) return c.json({ error: 'Antes activa al menos un documento con texto.' }, 400);
    }
    await store.setSetting(SETTINGS.knowledgeMode, parsed.data.mode);
    const label = parsed.data.mode === 'docs' ? 'los documentos separados' : 'el documento único';
    await store.logEvent('setter', `${who(c)} hizo que la IA use ${label}.`, null);
    return c.json({ ok: true, message: `Ahora la IA usa ${label}.` });
  });

  api.post('/', async (c) => {
    const parsed = titleSchema.safeParse(await readJson(c));
    const base = parsed.success ? slugify(parsed.data.title) : '';
    if (!parsed.success || !base) return c.json({ error: `Ponle un título (1-${MAX_TITLE} caracteres, con letras o números).` }, 400);
    const docs = await ensureBaseDocs();
    let slug = base;
    for (let n = 2; docs.some((doc) => doc.slug === slug); n++) slug = `${base}-${n}`;
    await store.saveKnowledgeDoc({ slug, title: parsed.data.title, position: Math.max(0, ...docs.map((d) => d.position)) + 1, active: true, builtin: false });
    await store.logEvent('setter', `${who(c)} creó el documento "${parsed.data.title}".`, { slug });
    return c.json({ slug }, 201);
  });

  api.post('/:slug', async (c) => {
    const doc = await findDoc(c.req.param('slug'));
    if (!doc) return c.json({ error: 'Ese documento no existe' }, 404);
    const parsed = textSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: `Texto demasiado largo (máximo ${MAX_DOC_CHARS} caracteres).` }, 400);
    const text = parsed.data.text.trim();
    if ((await store.getKnowledge(docKind(doc.slug)))?.text === text) return c.json({ ok: true, message: 'Sin cambios: no se crea versión nueva.' });
    await store.saveKnowledge(text, docKind(doc.slug));
    await store.logEvent('setter', `${who(c)} guardó el documento "${doc.title}".`, { slug: doc.slug, chars: text.length });
    return c.json({ ok: true, message: `"${doc.title}" guardado.` });
  });

  api.post('/:slug/restore', async (c) => {
    const doc = await findDoc(c.req.param('slug'));
    const parsed = restoreSchema.safeParse(await readJson(c));
    if (!doc || !parsed.success) return c.json({ error: 'Esa versión no existe' }, 404);
    const version = (await store.listKnowledgeVersions(VERSIONS_SHOWN, docKind(doc.slug))).find((v) => v.id === parsed.data.versionId);
    if (!version) return c.json({ error: 'Esa versión no existe' }, 404);
    await store.saveKnowledge(version.text, docKind(doc.slug));
    await store.logEvent('setter', `${who(c)} volvió a una versión anterior de "${doc.title}".`, { slug: doc.slug, versionId: version.id });
    return c.json({ ok: true, message: `"${doc.title}": recuperada la versión anterior.` });
  });

  api.post('/:slug/meta', async (c) => {
    const doc = await findDoc(c.req.param('slug'));
    if (!doc) return c.json({ error: 'Ese documento no existe' }, 404);
    const parsed = metaSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Datos no válidos.' }, 400);
    // Los de la lista base mantienen su título (así la IA y Jose hablan siempre de lo mismo).
    const title = doc.builtin ? doc.title : (parsed.data.title ?? doc.title);
    await store.saveKnowledgeDoc({ ...doc, title, active: parsed.data.active ?? doc.active });
    return c.json({ ok: true });
  });

  api.post('/:slug/move', async (c) => {
    const parsed = moveSchema.safeParse(await readJson(c));
    if (!parsed.success) return c.json({ error: 'Dirección no válida.' }, 400);
    const docs = await ensureBaseDocs();
    const index = docs.findIndex((doc) => doc.slug === c.req.param('slug'));
    if (index === -1) return c.json({ error: 'Ese documento no existe' }, 404);
    const other = docs[parsed.data.dir === 'up' ? index - 1 : index + 1];
    const doc = docs[index] as KnowledgeDocRow;
    if (other) {
      await store.saveKnowledgeDoc({ ...doc, position: other.position });
      await store.saveKnowledgeDoc({ ...other, position: doc.position });
    }
    return c.json({ ok: true });
  });

  api.post('/:slug/delete', async (c) => {
    const doc = await findDoc(c.req.param('slug'));
    if (!doc) return c.json({ error: 'Ese documento no existe' }, 404);
    if (doc.builtin) return c.json({ error: 'Los documentos de la lista base no se borran: desactívalo si no lo quieres usar.' }, 400);
    if (((await readJson(c)) as { confirm?: unknown } | null)?.confirm !== 'BORRAR') return c.json({ error: 'Para borrar, escribe BORRAR.' }, 400);
    await store.deleteKnowledgeDoc(doc.slug);
    await store.logEvent('setter', `${who(c)} borró el documento "${doc.title}".`, { slug: doc.slug });
    return c.json({ ok: true });
  });

  return api;
}
