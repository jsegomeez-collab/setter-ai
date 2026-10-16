import { describe, expect, it, vi } from 'vitest';
import { validateFlow } from '../src/flows/types.js';
import { deriveLinkSecret, readLinkToken } from '../src/links.js';
import type { InstagramClient } from '../src/meta/client.js';
import { processWebhook } from '../src/process.js';
import { Sender } from '../src/sender.js';
import { JOSE_FLOW } from './fixtures.js';
import { STRANGER_ID, commentPayload, createMemoryStore, postbackPayload } from './helpers.js';

const SECRET = deriveLinkSecret('clave-de-cifrado-larga-123');
const flowResult = validateFlow(JOSE_FLOW);
if (!flowResult.ok) throw new Error('JOSE_FLOW no es válido');
const flow = flowResult.flow;

function setup() {
  const store = createMemoryStore();
  store.flows.set(flow.id, flow);
  const client = {
    replyToComment: vi.fn().mockResolvedValue({ id: 'r1' }),
    sendPrivateReply: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm1' }),
    sendMessage: vi.fn().mockResolvedValue({ recipientId: STRANGER_ID, messageId: 'm2' }),
    getFollowStatus: vi.fn().mockResolvedValue({ status: 'yes', detail: 'ok' }),
  } as unknown as InstagramClient & Record<string, ReturnType<typeof vi.fn>>;
  const schedule = vi.fn().mockResolvedValue(true);
  const sender = new Sender(
    { store, client, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 }, sleep: async () => undefined, linkSigner: { baseUrl: 'https://setter.example.com', secret: SECRET }, schedule },
    async (id) => store.flows.get(id),
  );
  return { store, client, schedule, sender };
}

describe('flujo real de Jose de punta a punta (con Instagram falso)', () => {
  it('comentario → DM; "si, mándamelo" → sigue → biblioteca con enlace firmado + pausa programada', async () => {
    const { store, client, schedule, sender } = setup();
    await processWebhook(commentPayload({ text: 'quiero' }), { store, sender });
    expect(client.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(store.contacts.get(STRANGER_ID)?.username).toBe('cuenta_prueba');

    await processWebhook(postbackPayload('F:manychat1:sigue'), { store, sender });
    await sender.idle();
    const [, message] = vi.mocked(client.sendMessage).mock.calls[0] as [string, { attachment: { payload: { text: string; buttons: readonly { url: string }[] } } }];
    expect(message.attachment.payload.text).toContain('biblioteca de recursos');
    const link = message.attachment.payload.buttons[0]?.url as string;
    expect(link.startsWith('https://setter.example.com/l/')).toBe(true);
    expect(readLinkToken(SECRET, link.split('/l/')[1] as string)).toMatchObject({ r: STRANGER_ID, t: ['biblioteca'], u: 'https://biblioteca.example.com' });
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'grupo', recipientId: STRANGER_ID, flowId: 'manychat1' }), 120);
  });

  it('al vencer la pausa, continueFlow manda el mensaje del grupo de WhatsApp', async () => {
    const { client, sender } = setup();
    const result = await sender.continueFlow({ flowId: 'manychat1', nodeId: 'grupo', recipientId: STRANGER_ID, dedupKey: 'pb:x:espera', depth: 3 });
    await sender.idle();
    expect(result).toMatchObject({ next: [expect.stringContaining('grupo')] });
    const [, message] = vi.mocked(client.sendMessage).mock.calls[0] as [string, { attachment: { payload: { text: string } } }];
    expect(message.attachment.payload.text).toContain('grupo de WhatsApp');
  });

  it('continueFlow no hace nada si el flujo se borró o se desactivó', async () => {
    const { store, sender, client } = setup();
    store.flows.set(flow.id, { ...flow, enabled: false });
    expect(await sender.continueFlow({ flowId: 'manychat1', nodeId: 'grupo', recipientId: '9', dedupKey: 'k', depth: 1 })).toMatchObject({ skipped: expect.stringContaining('desactivado') });
    expect(await sender.continueFlow({ flowId: 'nada', nodeId: 'grupo', recipientId: '9', dedupKey: 'k', depth: 1 })).toMatchObject({ skipped: expect.any(String) });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('sin programador configurado, la pausa queda como error registrado (no rompe la cola)', async () => {
    const store = createMemoryStore();
    const sender = new Sender({ store, client: {} as InstagramClient, limits: { privateReplies: 100, publicReplies: 100, followUps: 100 }, delays: { commentMin: 0, commentMax: 0, followUpMin: 0, followUpMax: 0 } }, async () => undefined);
    await sender.enqueue([{ type: 'schedule', dedupKey: 's1', recipientId: '9', flowId: 'f', nodeId: 'n', delaySeconds: 60, depth: 1 }]);
    expect(store.actions.get('s1')).toMatchObject({ ok: false, response: { message: expect.stringContaining('programador') } });
  });
});
