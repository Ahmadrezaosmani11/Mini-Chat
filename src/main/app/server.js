import path from 'node:path';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { AppError } from '../../core/errors.js';
import { LaunchGate } from './launch-gate.js';
import { UiSessions } from './session.js';
import { applySecurityHeaders } from './security-headers.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMeRoutes } from './routes/me.js';
import { registerContactRoutes } from './routes/contacts.js';
import { registerEventRoutes } from './routes/events.js';
import * as C from '../../config/constants.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export async function startLocalApi({ runtime, uiDir, secureStorageAvailable = true, config = {} }) {
  const port = config.port ?? C.UI_PORT;
  const hosts = new Set([`${C.UI_HOST}:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://${C.UI_HOST}:${port}`, `http://localhost:${port}`]);
  const gate = new LaunchGate();
  const sessions = new UiSessions();
  const app = Fastify({ bodyLimit: C.API_BODY_LIMIT_BYTES, logger: false });

  await app.register(fastifyCookie);

  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: C.API_BODY_LIMIT_BYTES }, (_req, body, done) => done(null, body));
app.addHook('onRequest', async (req, reply) => {
    const forbid = () => {
      reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden.' } });
      return reply;
    };
    if (!LOOPBACK.has(req.socket.remoteAddress)) return forbid();
    if (!hosts.has(req.headers.host)) return forbid();
    const origin = req.headers.origin;
    if (origin !== undefined && !origins.has(origin)) return forbid();
    if (!['GET', 'HEAD'].includes(req.method) && !origin) return forbid();
    const url = new URL(req.url, `http://${C.UI_HOST}:${port}`);
    if (url.pathname === '/' && url.searchParams.has('launch')) {
      const cookie = gate.redeem(url.searchParams.get('launch'));
      if (!cookie) return forbid();
      reply.setCookie(C.UI_COOKIE, cookie, { httpOnly: true, sameSite: 'strict', path: '/' });
      return reply.redirect('/', 302);
    }
    if (!gate.hasUiCookie(req.cookies[C.UI_COOKIE])) return forbid();
    return undefined;
  });
  app.addHook('onSend', async (_req, reply, payload) => {
    applySecurityHeaders(reply, { api: reply.request.url.startsWith('/api/') });
    return payload;
  });
  app.setErrorHandler((error, _req, reply) => {
    let e;
    if (error instanceof AppError) e = error;
    else if (error instanceof ZodError) e = new AppError('VALIDATION', { message: 'Invalid input.' });
    else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') e = new AppError('TOO_LARGE', { message: 'Request too large.' });
    else if (error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') e = new AppError('UNSUPPORTED_TYPE', { message: 'Unsupported type.' });
    else if (error.statusCode === 400 || error.code?.startsWith('FST_ERR_CTP')) e = new AppError('VALIDATION', { message: 'Invalid input.' });
    else {
      runtime.logger.log('api', 'INTERNAL_ERROR');
      e = new AppError('INTERNAL', { message: 'Something went wrong.' });
    }
    const body = { error: { code: e.detail ?? e.code, message: e.message } };
    if (e.retryAfterSeconds !== undefined) body.error.retryAfterSeconds = e.retryAfterSeconds;
    reply.code(e.status).send(body);
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    else reply.code(404).send('Not found');
  });
  const ctx = {
    runtime,
    sessions,
    secureStorageAvailable,
    requireSession: async (req) => {
      const s = sessions.get(req.cookies[C.SESSION_COOKIE]);
      if (!s || !runtime.accounts.loggedIn) throw new AppError('AUTH', { message: 'Sign in required.' });
      req.ui = { sid: req.cookies[C.SESSION_COOKIE], csrf: s.csrf };
    },
    requireCsrf: async (req) => {
      if (!UiSessions.csrfMatches(req.ui?.csrf, req.headers['x-csrf-token'])) {
        throw new AppError('FORBIDDEN', { message: 'Forbidden.' });
      }
    },
    startSession: (reply) => {
      const { sid, csrf } = sessions.create();
      reply.setCookie(C.SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'strict', path: '/' });
      return csrf;
    },
  };
  ctx.read = { preHandler: [ctx.requireSession] };
  ctx.write = { preHandler: [ctx.requireSession, ctx.requireCsrf] };
  registerAuthRoutes(app, ctx);
  registerMeRoutes(app, ctx);
  registerContactRoutes(app, ctx);
  registerEventRoutes(app, ctx);

  runtime.bus.on('event', (e) => {
    if (e.type === 'session') sessions.clear();
  });

  await app.register(fastifyStatic, { root: path.resolve(uiDir), prefix: '/', index: 'index.html' });
  await app.listen({ host: C.UI_HOST, port });

  return {
    app,
    port,
    launchToken: gate.token,
    close: () => app.close(),
  };
}
