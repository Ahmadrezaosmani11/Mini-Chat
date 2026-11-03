import { z } from 'zod';
import { AppError } from '../../../core/errors.js';
import { normalisePeerId } from '../../../core/crypto/ids.js';
import { MESSAGE_PAGE_DEFAULT, MESSAGE_PAGE_MAX } from '../../../config/constants.js';

const q = z.object({ q: z.string().max(100).optional() });

export function registerContactRoutes(app, ctx) {
  const { contacts, discovery, session, history, messages, profile } = ctx.runtime;
  const peerParam = (req) => {
    const id = normalisePeerId(req.params.peerId);
    if (!id) throw new AppError('VALIDATION', { message: 'Invalid input.' });
    return id;
  };
  app.get('/api/peers', ctx.read, async (req) => {
    const { q: needle } = q.parse(req.query);
    const known = new Set(contacts.list().map((c) => c.peerId));
    const n = (needle ?? '').toLowerCase();
    return discovery
      .list()
      .filter((p) => !n || p.displayName.toLowerCase().includes(n))
      .map((p) => ({ ...p, isContact: known.has(p.peerId), peerIdHint: p.peerId.slice(0, 6) }));
  });

  app.get('/api/contacts', ctx.read, async (req) => {
    const { q: needle } = q.parse(req.query);
    return contacts.list(needle).map((c) => ({ ...c, connection: session.connectionState(c.peerId) }));
  });
  app.post('/api/contacts', ctx.write, async (req) => {
    const body = z.object({ peerId: z.string().max(100), source: z.enum(['manual', 'discovered']) }).strict().parse(req.body);
    return body.source === 'manual' ? contacts.addByPeerId(body.peerId) : contacts.addDiscovered(body.peerId);
  });

  app.patch('/api/contacts/:peerId', ctx.write, async (req) => {
    const { localLabel } = z.object({ localLabel: z.string().max(512).nullable() }).strict().parse(req.body);
    contacts.setLabel(peerParam(req), localLabel);
    return { ok: true };
  });

  app.delete('/api/contacts/:peerId', ctx.write, async (req) => {
    contacts.remove(peerParam(req));
    return { ok: true };
  });

  app.post('/api/contacts/:peerId/verify', ctx.write, async (req) => {
    const { verificationValue } = z.object({ verificationValue: z.string().max(120) }).strict().parse(req.body);
    return contacts.verify(peerParam(req), verificationValue);
  });
  app.get('/api/contacts/:peerId/photo', ctx.read, async (req, reply) => {
    const jpeg = profile.contactPhoto(peerParam(req));
    if (!jpeg) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    return reply.type('image/jpeg').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(jpeg));
  });
  app.get('/api/conversations', ctx.read, async () => history.listConversations());

  app.post('/api/conversations', ctx.write, async (req) => {
    const { peerId } = z.object({ peerId: z.string().max(100) }).strict().parse(req.body);
    const id = normalisePeerId(peerId);
    if (!id || !contacts.get(id)) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    return history.ensureConversation(id);
  });

  const convoOr404 = (req) => {
    const c = history.getConversation(req.params.id);
    if (!c) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    return c;
  };
  app.get('/api/conversations/:id/messages', ctx.read, async (req) => {
    const query = z
      .object({
        before: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_MAX).default(MESSAGE_PAGE_DEFAULT),
      })
      .parse(req.query);
    convoOr404(req);
    return history.listMessages(req.params.id, query);
  });

  app.post('/api/conversations/:id/read', ctx.write, async (req) => {
    convoOr404(req);
    history.markRead(req.params.id);
    return { ok: true };
  });

  app.delete('/api/conversations/:id', ctx.write, async (req) => {
    convoOr404(req);
    history.deleteConversation(req.params.id);
    return { ok: true };
  });
  app.post('/api/messages', ctx.write, async (req) => {
    const { peerId, text } = z.object({ peerId: z.string().max(100), text: z.string().max(70000) }).strict().parse(req.body);
    return messages.send(peerId, text);
  });
}
