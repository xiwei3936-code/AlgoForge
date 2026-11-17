/* 八股文板块的「原文」端点。
 * ------------------------------------------------------------------
 *   GET /api/bagu/status            原文在不在、在哪
 *   GET /api/bagu/original/<卡号>    这张卡对应的原文（合并过的题按来源分段）
 *   GET /api/bagu/intro/<篇代号>     篇首导读（JVM 的思维导图之类）
 *   GET /api/bagu/img/<文件名>       原文里的图
 *
 * ══════ 为什么原文要走服务端、而不是打进 dist ══════
 * 两份原书的版权不是我们的，能不能进仓库 / 发给别人用户还没定（八股第 7 题）。
 * 打包脚本会在开发机上重新构建 dist —— 原文要是在构建时打进去，就跟着安装包发出去了。
 * 放在仓库外、运行时读，就天然不会进仓库、不会进包：别人的机器上没有这个目录，
 * status 回 available:false，界面就不显示「原文」那一栏，其余功能照常。
 *
 * 2026-10-11 用户定（第 7 题）：安装包只发朋友学习用，**安装包里可以带原文**；仓库里仍然不放，
 * 要上传 GitHub 时再单独商量。所以打包脚本会把原文拷进包里的 bagu\（--no-originals 可以不带）。
 *
 * 目录按顺序找：环境变量 HOT100_BAGU_DIR → 程序目录里的 bagu\（安装包）→ 仓库旁边的 ../bagu-source（开发机）。
 * 读的是其中的 out/originals.json 与 out/img/java/。
 *
 * 门禁：和快照、Java 运行同一道跨站检查（crossSiteRejected）。卡号 / 篇代号 / 图片名
 * 都按白名单格式校验，绝不拿请求里的字符串去拼任意路径。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crossSiteRejected, json } from './java-runner.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const CARD_ID_RE = /^[a-z]{2,8}-(?:new-)?[a-z0-9]{1,12}$/;
export const PART_KEY_RE = /^[a-z]{2,8}(?:\d{2})?$/;
export const IMG_RE = /^[0-9a-f]{16}\.(png|jpe?g)$/;
const IMG_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

export function baguDir(env = process.env) {
  if (env.HOT100_BAGU_DIR) return resolve(env.HOT100_BAGU_DIR);
  // 安装包里：打包时把原文拷进程序目录的 bagu\（用户 2026-10-11 定：安装包只发朋友学习用，可以带原文）
  const inPkg = join(ROOT, 'bagu');
  if (existsSync(join(inPkg, 'out', 'originals.json'))) return inPkg;
  // 开发机上：仓库旁边的 bagu-source（仓库里永远不放原文）
  return resolve(ROOT, '..', 'bagu-source');
}

/* originals.json 有 700KB，每次请求都读一遍没必要；按 mtime 缓存，文件更新了自动重读 */
let cache = { path: '', mtime: 0, data: null };
export function loadOriginals(dir = baguDir()) {
  const p = join(dir, 'out', 'originals.json');
  if (!existsSync(p)) return null;
  const mtime = statSync(p).mtimeMs;
  if (cache.path !== p || cache.mtime !== mtime) {
    cache = { path: p, mtime, data: JSON.parse(readFileSync(p, 'utf8')) };
  }
  return cache.data;
}

export default function baguApiPlugin() {
  const attach = (server) => {
    server.middlewares.use('/api/bagu', (req, res) => {
      if (crossSiteRejected(req, res)) return;
      if (req.method !== 'GET') return json(res, 405, { ok: false, message: '只接受 GET' });
      const path = decodeURIComponent(req.url.split('?')[0]);
      const dir = baguDir();

      let data;
      try {
        data = loadOriginals(dir);
      } catch (e) {
        return json(res, 500, { ok: false, message: '原文文件读不出来：' + String((e && e.message) || e) });
      }

      if (path === '/status' || path === '/status/') {
        return json(res, 200, { ok: true, available: !!data, dir, cards: data ? Object.keys(data.cards).length : 0 });
      }
      if (!data) return json(res, 404, { ok: false, available: false, message: '这台机器上没有原文（bagu-source 不在）' });

      let m = path.match(/^\/original\/([^/]+)$/);
      if (m) {
        if (!CARD_ID_RE.test(m[1])) return json(res, 400, { ok: false, message: '卡号格式不对' });
        const card = data.cards[m[1]];
        if (!card) return json(res, 404, { ok: false, message: '这张卡没有原文' });
        return json(res, 200, { ok: true, ...card });
      }
      m = path.match(/^\/intro\/([^/]+)$/);
      if (m) {
        if (!PART_KEY_RE.test(m[1])) return json(res, 400, { ok: false, message: '篇代号格式不对' });
        return json(res, 200, { ok: true, blocks: data.intros[m[1]] || [] });
      }
      m = path.match(/^\/img\/([^/]+)$/);
      if (m) {
        if (!IMG_RE.test(m[1])) return json(res, 400, { ok: false, message: '图片名格式不对' });
        const p = join(dir, 'out', 'img', 'java', m[1]);
        if (!existsSync(p)) return json(res, 404, { ok: false, message: '图片不存在' });
        res.statusCode = 200;
        res.setHeader('Content-Type', IMG_TYPE[m[1].split('.').pop()]);
        res.setHeader('Cache-Control', 'private, max-age=86400');
        return res.end(readFileSync(p));
      }
      return json(res, 404, { ok: false, message: '没有这个端点' });
    });
  };
  return { name: 'hot100-bagu-api', configureServer: attach, configurePreviewServer: attach };
}
