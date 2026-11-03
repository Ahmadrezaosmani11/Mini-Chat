import { SSE_HEARTBEAT_MS } from '../../../config/constants.js';
import { SECURITY_HEADERS } from '../security-headers.js';

export function registerEventRoutes(app, ctx) {
  const { bus } = ctx.runtime;

  app.get('/api/events', ctx.read, (req, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    raw.write(': connected\n\n');
    const onEvent = ({ type, data }) => raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    bus.on('event', onEvent);
    const heartbeat = setInterval(() => raw.write(': hb\n\n'), SSE_HEARTBEAT_MS);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      bus.off('event', onEvent);
    });
  });
}
