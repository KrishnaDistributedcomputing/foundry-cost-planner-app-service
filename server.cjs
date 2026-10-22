'use strict';

// Dependency-free host for the calculator's ready-to-run dist/ directory.
// App Service supplies PORT. Authentication and HTTPS are configured in Azure.
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const distRoot = fs.realpathSync(path.join(__dirname, 'dist'));
const portValue = process.env.PORT || '8080';
if (!/^\d+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
  throw new Error('PORT must be a number between 1 and 65535.');
}
const port = Number(portValue);

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.pdf', 'application/pdf'],
]);

function isInsideRoot(filePath) {
  const relative = path.relative(distRoot, filePath);
  return relative !== '' && relative !== '..' &&
    !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function reply(req, res, status, message, extraHeaders = {}) {
  const body = Buffer.from(message + '\n');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    reply(req, res, 405, 'Method not allowed', { Allow: 'GET, HEAD' });
    return;
  }

  // Check the raw request path before any URL normalization can remove '..'.
  if (!req.url || !req.url.startsWith('/') || req.url.startsWith('//')) {
    reply(req, res, 400, 'Bad request');
    return;
  }
  if (req.url.length > 8192) {
    reply(req, res, 414, 'URI too long');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    reply(req, res, 400, 'Malformed request path');
    return;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(pathname) ||
      pathname.split('/').some(segment => segment.startsWith('.'))) {
    reply(req, res, 404, 'Not found');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const candidate = path.resolve(distRoot, '.' + pathname);
  const contentType = contentTypes.get(path.extname(candidate).toLowerCase());
  if (!isInsideRoot(candidate) || !contentType) {
    reply(req, res, 404, 'Not found');
    return;
  }

  let file;
  try {
    // Resolve symlinks too, so an asset cannot escape dist/ through a link.
    const realFile = await fsp.realpath(candidate);
    if (!isInsideRoot(realFile)) {
      reply(req, res, 404, 'Not found');
      return;
    }
    file = await fsp.open(realFile, 'r');
    const stat = await file.stat();
    if (!stat.isFile()) {
      await file.close();
      file = undefined;
      reply(req, res, 404, 'Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      // Assets are not content-hashed; revalidate after each deployment.
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') {
      await file.close();
      file = undefined;
      res.end();
      return;
    }
    const stream = file.createReadStream({ autoClose: true });
    file = undefined; // The stream now owns and closes this descriptor.
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    if (file) await file.close().catch(() => {});
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes(error.code)) {
      reply(req, res, 404, 'Not found');
      return;
    }
    console.error('Static file request failed:', error.code || 'UNKNOWN');
    reply(req, res, 500, 'Internal server error');
  }
});

server.headersTimeout = 15000;
server.requestTimeout = 30000;
server.keepAliveTimeout = 5000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Calculator ready on port ${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
