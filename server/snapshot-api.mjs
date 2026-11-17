/* 自动快照的三个端点。存储规则见 server/snapshot-store.mjs 顶部。
 *
 *   POST /api/snapshot          页面把一份「和手动导出一模一样」的备份交上来，存到磁盘
 *   GET  /api/snapshot          列出现有快照（只回元信息，不回内容）
 *   GET  /api/snapshot/<文件名>  取一份的完整内容，供界面里一键恢复
 *
 * 三个都走 java-runner 里那道**同一个**跨站检查 —— 新端点各写一份门禁，
 * 迟早会有一处忘了写。本机服务能读写磁盘，这道门不能松。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { crossSiteRejected, json } from './java-runner.mjs';
import {
  snapshotDir, listSnapshots, saveSnapshot, SNAPSHOT_RE, MAX_SNAPSHOT_BYTES,
} from './snapshot-store.mjs';
import { appendEvent, readEvents, eventLogPath, MAX_EVENT_BYTES } from './probe-log.mjs';

const BODY_TIMEOUT_MS = 30000;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const to = setTimeout(() => {
      if (!done) { done = true; reject(Object.assign(new Error('读取请求体超时'), { status: 408 })); }
    }, BODY_TIMEOUT_MS);
    const fin = (fn, v) => { if (done) return; done = true; clearTimeout(to); fn(v); };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      // 超限不立刻 destroy：先让 413 正常回出去，否则前端只看到连接被重置
      if (size > limit) { fin(reject, Object.assign(new Error('快照过大（上限 32MB）'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => fin(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => fin(reject, e));
  });
}

export default function snapshotApiPlugin() {
  const attach = (server) => {
    server.middlewares.use('/api/snapshot', async (req, res, next) => {
      const path = req.url.split('?')[0];
      if (crossSiteRejected(req, res)) return;
      const dir = snapshotDir();

      // ---- 列表 ----
      if (req.method === 'GET' && (path === '/' || path === '')) {
        try {
          const items = listSnapshots(dir).map((s) => ({
            name: s.name, bytes: s.bytes, savedAt: s.savedAt,
            score: s.score, detail: s.detail, broken: s.broken,
          }));
          return json(res, 200, { ok: true, dir, items });
        } catch (e) {
          return json(res, 500, { ok: false, message: '列举快照失败：' + String((e && e.message) || e) });
        }
      }

      // ---- 存储探针的事件日志 ----
      // 挂在这条中间件下面而不是自开一个 /api/probe：跨站检查、请求体读取都能直接复用。
      // 新端点各写一份门禁，迟早会有一处忘了写。
      if (path === '/probe') {
        if (req.method === 'GET') {
          try {
            // 一并回 logPath / logBytes：远程排查时一句「打开这个地址看看」就能确认
            // 探针到底写没写、写了多少 —— 不然只能让人去翻文件夹。
            const p = eventLogPath(dir);
            let bytes = -1;
            try { bytes = existsSync(p) ? statSync(p).size : 0; } catch { bytes = -1; }
            return json(res, 200, { ok: true, dir, logPath: p, logBytes: bytes, events: readEvents(dir, { limit: 200 }) });
          } catch (e) {
            return json(res, 500, { ok: false, message: '读取事件日志失败：' + String((e && e.message) || e) });
          }
        }
        if (req.method !== 'POST') return json(res, 405, { ok: false, message: '只接受 GET / POST' });
        // sendBeacon 送来的 Blob 也带这个 Content-Type（见 src/probe.js）
        if (!String(req.headers['content-type'] || '').includes('application/json')) {
          return json(res, 415, { ok: false, message: '只接受 application/json' });
        }
        let raw;
        try {
          raw = JSON.parse(await readBody(req, MAX_EVENT_BYTES));
        } catch (e) {
          return json(res, e && e.status === 413 ? 413 : 400, { ok: false, message: String((e && e.message) || e) });
        }
        // 写不进去也回 200：探针是旁路，页面不该因为它出错而做任何事。
        const r = appendEvent(dir, raw);
        return json(res, 200, { ok: true, written: r.ok });
      }

      // ---- 取一份 ----
      if (req.method === 'GET') {
        const name = decodeURIComponent(path.replace(/^\//, ''));
        // 只认我们自己生成的文件名。这同时挡住了 ../ 之类的路径穿越 ——
        // 不要用 path.normalize 去"清理"再拼，白名单式匹配才是可靠的。
        if (!SNAPSHOT_RE.test(name)) return json(res, 400, { ok: false, message: '文件名不合法' });
        const p = join(dir, name);
        if (!existsSync(p)) return json(res, 404, { ok: false, message: '这份快照不在了' });
        try {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          return res.end(readFileSync(p, 'utf8'));
        } catch (e) {
          return json(res, 500, { ok: false, message: '读取失败：' + String((e && e.message) || e) });
        }
      }

      // ---- 存一份 ----
      if (req.method === 'POST' && (path === '/' || path === '')) {
        const ctype = String(req.headers['content-type'] || '');
        if (!ctype.includes('application/json')) {
          return json(res, 415, { ok: false, message: '只接受 application/json' });
        }
        let backup;
        try {
          backup = JSON.parse(await readBody(req, MAX_SNAPSHOT_BYTES));
        } catch (e) {
          return json(res, e && e.status === 413 ? 413 : 400, { ok: false, message: String((e && e.message) || e) });
        }
        if (!backup || backup.app !== 'hot100-trainer' || !backup.data || typeof backup.data !== 'object') {
          return json(res, 400, { ok: false, message: '不是本工具的备份结构' });
        }
        try {
          const r = saveSnapshot(dir, backup);
          return json(res, 200, { ok: true, dir, ...r });
        } catch (e) {
          return json(res, 500, { ok: false, message: '写入失败：' + String((e && e.message) || e) });
        }
      }

      return next();
    });
  };

  return {
    name: 'hot100-snapshot-api',
    configureServer: attach,          // npm run dev
    configurePreviewServer: attach,   // 桌面快捷方式走的是 preview
  };
}
