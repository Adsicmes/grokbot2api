// grokbot2api-web — 极简只读看板 + 测试对话
// 上游是 127.0.0.1:3010 的 grokbot2api 容器；Bearer 由服务端注入，绝不发给浏览器。
// 访问控制不在这里做：Caddy 用 mTLS 挡住整个域名（web.grokbot2api.frzmeow.cc）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 3011);
const UPSTREAM = process.env.UPSTREAM || 'http://grokbot2api:3010';
const KEY = process.env.GROKBOT_API_KEY || '';
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const headers = (extra = {}) => ({ authorization: `Bearer ${KEY}`, ...extra });
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((r) => {
  const c = [];
  req.on('data', (d) => c.push(d));
  req.on('end', () => r(Buffer.concat(c).toString('utf8') || '{}'));
});

async function call(p, init = {}) {
  return fetch(UPSTREAM + p, { ...init, headers: headers(init.headers || {}) });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/' || url === '/index.html') {
      const html = fs.readFileSync(path.join(ROOT, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(html);
    }

    if (url === '/api/overview' && req.method === 'GET') {
      const t0 = Date.now();
      try {
        const [st, us] = await Promise.all([call('/admin/status'), call('/admin/usage')]);
        if (!st.ok || !us.ok) return json(res, 502, { error: `upstream ${st.status}/${us.status}` });
        const status = await st.json();
        const usage = await us.json();
        const byEmail = Object.fromEntries((usage.usage || []).map((u) => [u.email, u]));
        const accounts = (status.accounts || []).map((a) => {
          const u = byEmail[a.email] || {};
          return {
            ...a,
            usagePercent: typeof u.usagePercent === 'number' ? u.usagePercent : null,
            nextResetUtc: u.nextResetUtc || null,
            hasAvailable: u.hasAvailable !== false,
          };
        });
        return json(res, 200, { accounts, upstreamMs: Date.now() - t0, ts: new Date().toISOString() });
      } catch (e) {
        return json(res, 502, { error: String(e.message || e) });
      }
    }

    if (url === '/api/chat' && req.method === 'POST') {
      const body = await readBody(req);
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
      parsed.stream = true; // 看板一律流式，前端边到边渲染
      const r = await call('/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') || 'text/event-stream',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      if (!r.body) return res.end();
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      return res.end();
    }

    if (url === '/healthz') return json(res, 200, { ok: true });
    return json(res, 404, { error: 'not found' });
  } catch (e) {
    try { json(res, 500, { error: String(e.message || e) }); } catch {}
  }
});

server.listen(PORT, () => console.log(`grokbot2api-web listening on :${PORT} -> ${UPSTREAM}`));
