import { z } from 'zod';
import { AppError } from '../../../core/errors.js';

export function registerMeRoutes(app, ctx) {
  const { accounts, profile } = ctx.runtime;

  app.get('/api/me', ctx.read, async () => accounts.me());
app.patch('/api/me/profile', ctx.write, async (req) => {
    const { displayName } = z.object({ displayName: z.string().max(512) }).strict().parse(req.body);
    return { displayName: profile.setDisplayName(displayName) };
  });
  app.get('/api/me/photo', ctx.read, async (_req, reply) => {
    const jpeg = profile.ownPhoto();
    if (!jpeg) throw new AppError('NOT_FOUND', { message: 'Not found.' });
    return reply.type('image/jpeg').header('X-Content-Type-Options', 'nosniff').send(Buffer.from(jpeg));
  });

  app.put('/api/me/photo', ctx.write, async (req) => {
    profile.setPhoto(new Uint8Array(req.body));
    return { ok: true };
  });

  app.delete('/api/me/photo', ctx.write, async () => {
    profile.removePhoto();
    return { ok: true };
  });
  app.patch('/api/me/settings', ctx.write, async (req) => {
    const { historyEnabled } = z.object({ historyEnabled: z.boolean() }).strict().parse(req.body);
    accounts.setHistoryEnabled(historyEnabled);
    return { historyEnabled };
  });

  app.post('/api/me/password', ctx.write, async (req) => {
    const body = z.object({ currentPassword: z.string().max(256), newPassword: z.string().max(256) }).strict().parse(req.body);
    await accounts.changePassword(body);
    return { ok: true };
  });
}
