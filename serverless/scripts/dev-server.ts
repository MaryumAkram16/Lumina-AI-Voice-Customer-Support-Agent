/**
 * Minimal local server that mounts the same handlers Vercel runs, for when
 * `vercel dev` is not available (no login, CI, containers).
 *
 *   npm run dev:local            # http://localhost:3000
 *   PORT=4000 npm run dev:local
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import * as cancelOrder from '../api/cancel-order.js';
import * as health from '../api/health.js';
import * as order from '../api/order.js';
import * as refundEligibility from '../api/refund-eligibility.js';
import * as returnItem from '../api/return-item.js';
import * as trackOrder from '../api/track-order.js';

type Handler = (request: Request) => Response | Promise<Response>;

const routes: Record<string, Handler> = {
  '/api/health': health.GET,
  '/api/track-order': trackOrder.POST,
  '/api/cancel-order': cancelOrder.POST,
  '/api/return-item': returnItem.POST,
  '/api/refund-eligibility': refundEligibility.POST,
  '/api/order': order.POST,
};

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const handler = routes[url.pathname];

    if (!handler) {
      if (url.pathname === '/') {
        const page = await readFile(new URL('../public/index.html', import.meta.url));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not_found"}');
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
    }
    // Vercel sets this header itself; locally we take it from the socket.
    headers.set('x-real-ip', req.socket.remoteAddress ?? 'unknown');

    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const response = await handler(
      new Request(url, {
        method: req.method ?? 'GET',
        headers,
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  })().catch(() => {
    res.writeHead(500).end();
  });
});

server.listen(port, () => {
  console.log(`Lumina serverless backend listening on http://localhost:${port}`);
});
