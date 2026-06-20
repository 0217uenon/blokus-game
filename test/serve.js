// minimal static file server for local testing only.
// Also exposes POST /api/save-reflection so the game can auto-save each post-game
// reflection into ../lessons/ (browsers cannot write local files themselves).
// Dev/test tool: it listens on all interfaces so a phone on the same LAN can
// reach it — run it ONLY on networks you trust.
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const lessonsDir = path.join(root, 'lessons');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i; // Windows device names

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(obj));
}

// Reject cross-origin browser requests (CSRF). Same-origin requests either omit
// Origin or send one whose host matches Host; tools like curl send no Origin.
// A malicious website driving the user's browser would send a foreign Origin.
function sameOriginOrNone(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

// Write one reflection Markdown into lessons/. The filename must already be a
// bare basename (no path components) ending in .md, so a client can never write
// outside the lessons directory.
function saveReflection(req, res) {
  if (!sameOriginOrNone(req)) return json(res, 403, { ok: false, error: 'forbidden' });
  const ct = req.headers['content-type'];
  if (ct && !/^application\/json/i.test(ct)) {
    return json(res, 415, { ok: false, error: 'unsupported media type' });
  }
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > 1e6) { req.destroy(); return; } // 1MB guard
    chunks.push(chunk);
  });
  req.on('end', () => {
    let data;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch (e) { return json(res, 400, { ok: false, error: 'bad json' }); }

    const raw = String(data.filename || '');
    const name = path.basename(raw);
    if (!name || name !== raw || !/\.md$/i.test(name) || RESERVED.test(name)) {
      return json(res, 400, { ok: false, error: 'invalid filename' });
    }
    const dest = path.join(lessonsDir, name);
    if (path.dirname(dest) !== lessonsDir) {           // defense in depth
      return json(res, 400, { ok: false, error: 'path escape' });
    }
    try { fs.mkdirSync(lessonsDir, { recursive: true }); } catch (e) { /* exists */ }
    fs.writeFile(dest, String(data.markdown || ''), 'utf8', (err) => {
      if (err) return json(res, 500, { ok: false, error: 'write failed' }); // no raw path leak
      console.log('saved reflection -> lessons/' + name);
      json(res, 200, { ok: true, path: 'lessons/' + name });
    });
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'POST' && urlPath === '/api/save-reflection') {
    return saveReflection(req, res);
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Allow': 'GET' }); res.end('method not allowed'); return;
  }

  // static GET — contained to the project root AND excluding dotfiles, so hidden
  // files like the entire .git/ directory are never served. path.join normalizes
  // '..' segments; we then verify the resolved path stays inside root.
  let p = decodeURIComponent(urlPath);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  const rel = path.relative(root, file);
  if (rel.split(path.sep).some((seg) => seg.startsWith('.'))) {
    res.writeHead(403); res.end('forbidden'); return;   // block .git, .gitignore, etc.
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});
server.requestTimeout = 10000;   // full-request timeout (slow-body / slowloris guard)
server.headersTimeout = 5000;
server.listen(8731, () => console.log('serving on http://localhost:8731'));
