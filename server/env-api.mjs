/* 本地环境信息端点 —— 只服务于界面上的「复制诊断信息」。
 * ------------------------------------------------------------------
 * 单独成文件而不是塞进 java-runner.mjs：它和 Java 无关；而且以后把 vite preview
 * 换成原生 http 服务器时，这两个端点是并列迁移的，各自独立更清楚。
 *
 * 只回三件事：本地服务跑在哪个 Node 版本、什么平台、什么架构。
 * **不读日志、不读文件、不回任何本机路径** —— 诊断信息是要用户自己复制出去发给别人的，
 * 能少带一点就少带一点。启动阶段的问题另有 %LOCALAPPDATA%\Hot100Trainer\*.log。
 *
 * Node 版本之所以值得单独问一次：精简版安装包用的是使用者自己装的 Node，
 * 版本不够时的失败方式往往看不懂，先知道版本能省一大圈弯路。
 */
import { crossSiteRejected, json } from './java-runner.mjs';

export default function envApiPlugin() {
  const attach = (server) => {
    server.middlewares.use('/api/env', (req, res, next) => {
      if (req.url.split('?')[0] !== '/') return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, message: '只接受 GET' });
      if (crossSiteRejected(req, res)) return;
      json(res, 200, {
        ok: true,
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
      });
    });
  };

  return {
    name: 'hot100-env-api',
    configureServer: attach,          // npm run dev
    configurePreviewServer: attach,   // npm run preview（桌面快捷方式走这条）
  };
}
