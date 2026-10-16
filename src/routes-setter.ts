import type { Context, Hono } from 'hono';
import type { AppDeps } from './app.js';
import { conversationPage, conversationsPage, setterPage } from './pages-setter.js';
import { parseUsernames, readSetterMode, type SetterMode } from './setter/service.js';
import { SETTINGS } from './store.js';

/** Panel del setter IA. Va detrás de la contraseña y del CSRF del panel (ver app.ts). */

const MAX_KNOWLEDGE_CHARS = 60_000;
const VERSIONS_SHOWN = 20;
const CONVERSATIONS_SHOWN = 200;
const THREAD_MESSAGES = 300;
const MODES: readonly SetterMode[] = ['off', 'test', 'live'];

const withMsg = (path: string, message: string) => `${path}?msg=${encodeURIComponent(message)}`;
const field = (body: Record<string, unknown>, name: string): string => (typeof body[name] === 'string' ? (body[name] as string) : '');

function registerSettings(app: Hono, deps: AppDeps): void {
  const { store, config } = deps;

  app.get('/setter', async (c) => {
    const [mode, draft, usernames, knowledge, versions] = await Promise.all([
      readSetterMode(store),
      store.getSetting(SETTINGS.setterDraft),
      store.getSetting(SETTINGS.setterTestUsernames),
      store.getKnowledge(),
      store.listKnowledgeVersions(VERSIONS_SHOWN),
    ]);
    return c.html(
      setterPage({
        mode,
        draft: draft === 'true',
        testUsernames: parseUsernames(usernames),
        apiKeyConfigured: config.setter.anthropicApiKey !== null,
        model: config.setter.model,
        knowledge,
        versions,
        flash: c.req.query('msg') ?? null,
      }),
    );
  });

  app.post('/setter/ajustes', async (c) => {
    const body = await c.req.parseBody();
    const mode = field(body, 'mode') as SetterMode;
    if (!MODES.includes(mode)) return c.redirect(withMsg('/setter', 'Modo no válido.'), 303);
    const usernames = parseUsernames(field(body, 'testUsernames'));
    await store.setSetting(SETTINGS.setterMode, mode);
    await store.setSetting(SETTINGS.setterDraft, field(body, 'draft') === 'true' ? 'true' : 'false');
    await store.setSetting(SETTINGS.setterTestUsernames, usernames.join(','));
    await store.logEvent('setter', `Ajustes del setter: modo ${mode}${field(body, 'draft') === 'true' ? ' (borrador)' : ''}.`, { mode, usernames });
    return c.redirect(withMsg('/setter', 'Ajustes guardados.'), 303);
  });
}

function registerKnowledge(app: Hono, deps: AppDeps): void {
  const { store } = deps;

  app.post('/setter/documento', async (c) => {
    const text = field(await c.req.parseBody(), 'text').replace(/\r\n/g, '\n').trim();
    if (text.length === 0) return c.redirect(withMsg('/setter', 'El documento está vacío: no se guarda.'), 303);
    if (text.length > MAX_KNOWLEDGE_CHARS) return c.redirect(withMsg('/setter', `El documento es demasiado largo (máximo ${MAX_KNOWLEDGE_CHARS} caracteres).`), 303);
    if ((await store.getKnowledge())?.text === text) return c.redirect(withMsg('/setter', 'Sin cambios: no se crea versión nueva.'), 303);
    const id = await store.saveKnowledge(text);
    await store.logEvent('setter', `Documento del setter guardado (versión #${id}).`, { id, chars: text.length });
    return c.redirect(withMsg('/setter', `Documento guardado (versión #${id}).`), 303);
  });

  app.post('/setter/documento/:id/restaurar', async (c) => {
    const wanted = Number(c.req.param('id'));
    const version = (await store.listKnowledgeVersions(VERSIONS_SHOWN)).find((v) => v.id === wanted);
    if (!version) return c.redirect(withMsg('/setter', 'Esa versión no existe.'), 303);
    const id = await store.saveKnowledge(version.text);
    await store.logEvent('setter', `Documento restaurado: la versión #${wanted} pasa a ser la #${id}.`, { from: wanted, id });
    return c.redirect(withMsg('/setter', `Versión #${wanted} restaurada (ahora es la #${id}).`), 303);
  });
}

function registerConversations(app: Hono, deps: AppDeps): void {
  const { store } = deps;

  app.get('/conversaciones', async (c) => c.html(conversationsPage(await store.listConversations(CONVERSATIONS_SHOWN), c.req.query('msg') ?? null)));

  app.get('/conversaciones/:igId', async (c) => {
    const igId = c.req.param('igId');
    const [contact, messages] = await Promise.all([store.getContact(igId), store.listMessages(igId, THREAD_MESSAGES)]);
    return c.html(conversationPage({ igId, contact, messages, flash: c.req.query('msg') ?? null }));
  });

  const setPaused = (paused: boolean) => async (c: Context) => {
    const igId = c.req.param('igId') ?? '';
    await store.setAiPaused(igId, paused, paused ? 'Parada a mano por Jose desde el panel' : null);
    await store.logEvent('setter', `IA ${paused ? 'parada' : 'reanudada'} a mano en la conversación.`, { igId });
    const path = `/conversaciones/${encodeURIComponent(igId)}`;
    return c.redirect(withMsg(path, paused ? 'IA parada en esta conversación.' : 'IA reanudada: responderá al próximo mensaje de la persona.'), 303);
  };
  app.post('/conversaciones/:igId/pausar', setPaused(true));
  app.post('/conversaciones/:igId/reanudar', setPaused(false));
}

export function registerSetter(app: Hono, deps: AppDeps): void {
  registerSettings(app, deps);
  registerKnowledge(app, deps);
  registerConversations(app, deps);
}
