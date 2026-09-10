/**
 * Serve the built board — no framework, with the three cautions a file server
 * needs and everyone likes to forget:
 *
 * ONE: NO ESCAPE. The path is resolved and must STILL lie under the root
 * afterwards. `..%2f..%2fetc%2fpasswd` is not an invented example, it is the
 * first thing every scanner tries.
 *
 * TWO: NEVER CACHE THE PAGE ITSELF. The file names carry a fingerprint and
 * may sit for a year; `index.html` may not, or after a deploy a browser will
 * point at bundles that no longer exist.
 *
 * THREE: AN UNKNOWN PATH IS THE PAGE, NOT A 404 — but only for GET and only
 * when it does not begin with /api or /auth. Otherwise the surface
 * accidentally answers questions that belong to the service.
 */

import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

/**
 * What the PAGE gets and a fingerprinted file does not. The board loads fonts
 * from Google and talks to itself — no more than that. What does NOT stand
 * here, the page cannot load either.
 */
const PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    "connect-src 'self'",
    // `base-uri 'none'` is why a card's address may be only ONE segment deep:
    // the bundle's own links are relative, and a page two segments down
    // could only be repaired with a <base> tag this forbids.
    "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; '),
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

export function createStatic(directory) {
  if (!directory) return null;
  const root = resolve(directory);

  const serve = async (res, file, { page = false, head = null } = {}) => {
    /*
     * `head` is markup put into the page's <head> before it goes out — the
     * open-graph tags of ONE card, escaped by the caller, and nothing else.
     * It is the reason a card can have one address instead of a link that
     * bounces through a query string on its way to the board.
     */
    if (head) {
      const html = (await readFile(file, 'utf8')).replace('</head>', `${head}</head>`);
      res.writeHead(200, { ...PAGE_HEADERS, 'Content-Type': TYPES['.html'], 'Content-Length': Buffer.byteLength(html) });
      res.end(html);
      return;
    }
    const info = await stat(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      // Fingerprint in the name → one year. The page itself → never.
      ...(page ? PAGE_HEADERS : { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }),
    });
    createReadStream(file).pipe(res);
  };

  return async function handle(req, res, path, { head = null } = {}) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (path.startsWith('/api') || path.startsWith('/auth')) return false;

    const clean = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
    const file = resolve(join(root, clean));
    if (file !== root && !file.startsWith(root + '/')) return false;

    // A card's address is asked for by name, so no file is looked for first —
    // and a real file always wins over a card key everywhere else, which is
    // why a key may look like a path at all.
    if (!head) {
      try {
        const info = await stat(file);
        if (info.isFile()) { await serve(res, file, { page: file.endsWith('index.html') }); return true; }
      } catch { /* on to the page */ }
    }

    try {
      await serve(res, join(root, 'index.html'), { page: true, head });
      return true;
    } catch {
      return false;
    }
  };
}
