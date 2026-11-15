/**
 * Minimal local server that mounts the same handlers Vercel runs, for when
 * `vercel dev` is not available (no login, CI, containers).
 *
 *   npm run build:web            # once, to build the page
 *   npm run dev:local            # http://localhost:3000
 *   PORT=4000 npm run dev:local
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cancelOrder from '../api/cancel-order.js';
import * as createWebCall from '../api/create-web-call.js';
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
  '/api/create-web-call': createWebCall.POST,
};

const port = Number(process.env.PORT ?? 3000);
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const handler = routes[url.pathname];

    if (!handler) {
      // Static files from the built page (`npm run build:web`).
      const relative = normalize(url.pathname === '/' ? 'index.html' : url.pathname).replace(
        /^([/\\]|\.\.)+/,
        '',
      );
      const file = join(publicDir, relative);
      try {
        if (!file.startsWith(publicDir)) throw new Error('outside public');
        const content = await readFile(file);
        res
          .writeHead(200, {
            'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
          })
          .end(content);
      } catch {
        const hint = url.pathname === '/' ? ' Run "npm run build:web" first.' : '';
        res.writeHead(404, { 'content-type': 'text/plain' }).end(`Not found.${hint}`);
      }
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
