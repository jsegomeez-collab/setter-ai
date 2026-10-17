import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { TokenManager } from '../src/meta/token.js';
import { knowledgeWarnings } from '../src/pages-setter.js';
import { SETTINGS } from '../src/store.js';
import { STRANGER_ID, TEST_SETTER_CONFIG, createMemoryStore, sampleOutput } from './helpers.js';

const HOST = 'http://localhost';
const PASSWORD = 'contraseña-larga-123';
const auth = `Basic ${Buffer.from(`jose:${PASSWORD}`).toString('base64')}`;

function config(apiKey: string | null = null): Config {
  return {
    port: 3000,
    databaseUrl: 'postgres://no-se-usa',
    adminPassword: PASSWORD,
    webhookVerifyToken: 'token-verificacion',
    appSecrets: ['secreto-ig'],
    igAccessToken: null,
    igApiVersion: 'v25.0',
    tokenEncryptionKey: null,
    publicBaseUrl: null,
    limits: { privateReplies: 700, publicReplies: 700, followUps: 3000 },
    delays: { commentMin: 1000, commentMax: 2000, followUpMin: 300, followUpMax: 800 },
    setter: { ...TEST_SETTER_CONFIG, anthropicApiKey: apiKey },
  };
}

function setup(apiKey: string | null = null) {
  const store = createMemoryStore();
  const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
  const app = createApp({ config: config(apiKey), store, client: null, tokens, processPayload: vi.fn(), linkSecret: null });
  const get = (path: string) => app.request(`${HOST}${path}`, { headers: { authorization: auth } });
  const post = (path: string, fields: Record<string, string> = {}, origin = HOST) =>
    app.request(`${HOST}${path}`, {
      method: 'POST',
      headers: { authorization: auth, origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(fields).toString(),
    });
  return { app, store, get, post };
}

describe('panel /setter', () => {
  it('pide contraseña y rechaza formularios enviados desde otra web', async () => {
    const { app, post } = setup();
    expect((await app.request(`${HOST}/setter`)).status).toBe(401);
    expect((await app.request(`${HOST}/conversaciones`)).status).toBe(401);
    expect((await post('/setter/ajustes', { mode: 'live' }, 'https://otra-web.com')).status).toBe(403);
  });

  it('muestra el estado: apagado por defecto, sin documento y sin clave', async () => {
    const page = await (await setup().get('/setter')).text();
    expect(page).toContain('Apagado (guarda los DMs, no responde)');
    expect(page).toContain('Falta ANTHROPIC_API_KEY');
    expect(page).toContain('Sin documento');
    expect(page).toContain('claude-haiku-5-5');
  });

  it('con clave lo indica (sin enseñarla)', async () => {
    const page = await (await setup('sk-ant-secreta').get('/setter')).text();
    expect(page).toContain('ANTHROPIC_API_KEY configurada');
    expect(page).not.toContain('sk-ant-secreta');
  });

  it('guarda modo, borrador y usuarios de prueba (limpios)', async () => {
    const { store, post } = setup();
    const res = await post('/setter/ajustes', { mode: 'test', draft: 'true', testUsernames: '@JoseGomezLife, otra ' });
    expect(res.status).toBe(303);
    expect(store.settings.get(SETTINGS.setterMode)).toBe('test');
    expect(store.settings.get(SETTINGS.setterDraft)).toBe('true');
    expect(store.settings.get(SETTINGS.setterTestUsernames)).toBe('josegomezlife,otra');
  });

  it('rechaza un modo que no existe', async () => {
    const { store, post } = setup();
    await post('/setter/ajustes', { mode: 'turbo' });
    expect(store.settings.has(SETTINGS.setterMode)).toBe(false);
  });

  it('el documento se guarda como versión nueva, sin duplicar si no cambia, y se puede restaurar', async () => {
    const { store, post, get } = setup();
    await post('/setter/documento', { text: 'Versión uno [LINK AGENDA] [LINK MEMBRESÍA]' });
    await post('/setter/documento', { text: 'Versión uno [LINK AGENDA] [LINK MEMBRESÍA]' });
    await post('/setter/documento', { text: 'Versión dos [LINK AGENDA] [LINK MEMBRESÍA]' });
    expect(store.knowledge.map((k) => k.text)).toEqual(['Versión uno [LINK AGENDA] [LINK MEMBRESÍA]', 'Versión dos [LINK AGENDA] [LINK MEMBRESÍA]']);
    await post('/setter/documento/1/restaurar');
    expect((await store.getKnowledge())?.text).toBe('Versión uno [LINK AGENDA] [LINK MEMBRESÍA]');
    expect(await (await get('/setter')).text()).toContain('Versión #3');
  });

  it('no guarda un documento vacío', async () => {
    const { store, post } = setup();
    await post('/setter/documento', { text: '   ' });
    expect(store.knowledge).toHaveLength(0);
  });

  it('avisa de los huecos sin confirmar del documento', () => {
    expect(knowledgeWarnings('Garantía [CONFIRMAR CONDICIONES]. Horas: [COMPLETAR] [LINK AGENDA] [LINK MEMBRESÍA]')).toEqual([
      expect.stringContaining('2 hueco(s)'),
    ]);
  });
});

describe('panel /conversaciones', () => {
  async function withConversation() {
    const ctx = setup();
    await ctx.store.touchContact(STRANGER_ID, 'josegomezlife');
    await ctx.store.addMessage({ igId: STRANGER_ID, direction: 'in', source: 'user', text: 'hola <script>alert(1)</script>', mid: 'm-1', status: 'sent', dedupKey: null });
    await ctx.store.addMessage({ igId: STRANGER_ID, direction: 'out', source: 'ai', text: 'Paga en https://otro.com', mid: null, status: 'held', dedupKey: 'ai:m-1', note: 'Enlace no permitido' });
    await ctx.store.saveLead(STRANGER_ID, sampleOutput({}, { siguiente_paso: 'agendar_llamada', usa_ia: 'ChatGPT para textos' }).lead);
    return ctx;
  }

  it('lista las conversaciones con el estado de la IA y el siguiente paso', async () => {
    const { get } = await withConversation();
    const page = await (await get('/conversaciones')).text();
    expect(page).toContain('@josegomezlife');
    expect(page).toContain('IA activa');
    expect(page).toContain('agendar_llamada');
  });

  it('la conversación enseña el historial de la ficha (cada cambio, con su etapa y fecha)', async () => {
    const ctx = await withConversation();
    await ctx.store.saveLead(STRANGER_ID, sampleOutput({}, { siguiente_paso: 'ofrecer_membresia', usa_ia: 'ChatGPT para textos' }).lead);
    const page = await (await ctx.get(`/conversaciones/${STRANGER_ID}`)).text();
    expect(page).toContain('Historial de la ficha');
    const history = page.slice(page.indexOf('Historial de la ficha'));
    expect(history.indexOf('agendar_llamada')).toBeGreaterThan(-1);
    expect(history.indexOf('agendar_llamada')).toBeLessThan(history.indexOf('ofrecer_membresia')); // de la más antigua a la más nueva
  });

  it('el hilo enseña los mensajes (escapados), los retenidos y la ficha', async () => {
    const { get } = await withConversation();
    const page = await (await get(`/conversaciones/${STRANGER_ID}`)).text();
    expect(page).toContain('hola &lt;script&gt;');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('RETENIDO (no enviado)');
    expect(page).toContain('Enlace no permitido');
    expect(page).toContain('ChatGPT para textos');
  });

  it('parar y reanudar la IA en una conversación', async () => {
    const { store, post } = await withConversation();
    await post(`/conversaciones/${STRANGER_ID}/pausar`);
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: true, aiPausedReason: 'Parada a mano por Jose desde el panel' });
    await post(`/conversaciones/${STRANGER_ID}/reanudar`);
    expect(await store.getContact(STRANGER_ID)).toMatchObject({ aiPaused: false, aiPausedReason: null });
  });

  it('al reanudar la IA, contesta ya si había un mensaje de la persona sin responder', async () => {
    const store = createMemoryStore();
    const tokens = new TokenManager({ store, envToken: null, encryptionKey: null });
    const replyPending = vi.fn().mockResolvedValue(undefined);
    const app = createApp({ config: config(), store, client: null, tokens, processPayload: vi.fn(), linkSecret: null, replyPending });
    await store.setAiPaused(STRANGER_ID, true, 'Jose escribió a mano');
    const res = await app.request(`${HOST}/conversaciones/${STRANGER_ID}/reanudar`, {
      method: 'POST',
      headers: { authorization: auth, origin: HOST, 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    expect(res.status).toBe(303);
    expect(replyPending).toHaveBeenCalledWith(STRANGER_ID);
  });
});
