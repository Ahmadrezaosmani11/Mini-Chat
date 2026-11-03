import { z } from 'zod';
import * as C from '../../../config/constants.js';

const credentials = z.object({ username: z.string().max(64), password: z.string().max(256) }).strict();
const registerBody = credentials.extend({ displayName: z.string().max(256) }).strict();
export function registerAuthRoutes(app, ctx) {
  const { runtime, sessions } = ctx;
  const { accounts } = runtime;

  app.get('/api/session', async (req) => {
    const s = sessions.get(req.cookies[C.SESSION_COOKIE]);
    const authenticated = Boolean(s) && accounts.loggedIn;
    return {
      accountExists: accounts.accountExists(),
      authenticated,
      secureStorageAvailable: ctx.secureStorageAvailable,
      ...(authenticated ? { csrfToken: s.csrf } : {}),
    };
  });
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerBody.parse(req.body);
    await accounts.register(body);
    return { csrfToken: ctx.startSession(reply) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = credentials.parse(req.body);
    await accounts.login(body);
    return { csrfToken: ctx.startSession(reply) };
  });
  app.post('/api/auth/logout', ctx.write, async (req, reply) => {
    await accounts.logout('logout');
    sessions.destroy(req.ui.sid);
    reply.clearCookie(C.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/reset', async (req, reply) => {
    const body = z.object({ confirm: z.literal('RESET') }).strict().parse(req.body);
    await accounts.resetInstallation(body);
    sessions.clear();
    reply.clearCookie(C.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.delete('/api/account', ctx.write, async (req, reply) => {
    const body = z.object({ password: z.string().max(256), confirm: z.literal('DELETE') }).strict().parse(req.body);
    await accounts.deleteAccount(body);
    sessions.clear();
    reply.clearCookie(C.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
}
