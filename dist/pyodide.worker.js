/* Pyodide Web Worker (classic worker)
 * ------------------------------------
 * 通过 importScripts 加载 public/pyodide/ 下的 Pyodide（已本地化，不走 CDN），
 * 避免让 Vite 去打包 Pyodide 的 .wasm 资源（那条路容易出各种打包报错）。
 * 放在 public/ 下，Vite 会原样伺服，不做任何转换，importScripts 才能正常工作。
 *
 * 与主线程的消息协议：
 *   主 -> Worker: { type: 'run', runId, code }
 *   Worker -> 主: { type: 'status', status: 'loading'|'ready'|'error', error? }
 *                 { type: 'result', runId, ok, stdout, error }
 */

// Pyodide 0.26.4 已本地化到 public/pyodide/（5 个文件与官方 CDN 字节一致，属等价替换）。
// 好处：断网也能运行代码、冷启动更快、不再依赖第三方 CDN 的可用性。
// 路径按 worker 自身位置解析，换 base 或换端口都不用改。
const INDEX_URL = new URL('./pyodide/', self.location.href).href;

// eslint-disable-next-line no-undef
importScripts(INDEX_URL + 'pyodide.js');

let pyodide = null;
let loadError = null;

async function boot() {
  try {
    self.postMessage({ type: 'status', status: 'loading' });
    // loadPyodide 由 importScripts 注入到全局
    // eslint-disable-next-line no-undef
    pyodide = await loadPyodide({ indexURL: INDEX_URL });
    self.postMessage({ type: 'status', status: 'ready' });
  } catch (err) {
    loadError = err;
    self.postMessage({
      type: 'status',
      status: 'error',
      error: String((err && err.message) || err),
    });
  }
}

// Worker 一创建就开始加载 Pyodide（首次约 10~20 秒）
const ready = boot();

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'run') return;
  const { runId, code } = msg;

  await ready;
  if (!pyodide) {
    self.postMessage({
      type: 'result',
      runId,
      ok: false,
      stdout: '',
      error: 'Python 运行环境加载失败：' + String((loadError && loadError.message) || loadError),
    });
    return;
  }

  let out = '';
  let ns = null;
  try {
    // 捕获 print / 报错输出。batched 回调按行触发，不含结尾换行，这里补回。
    pyodide.setStdout({ batched: (s) => { out += s + '\n'; } });
    pyodide.setStderr({ batched: (s) => { out += s + '\n'; } });
    // 每次运行都用**全新的命名空间**。否则上一次定义的 Solution 会留在全局里，
    // 用户把代码删光后再运行仍会「全部通过」并被自动标记完成 —— 判题工具最致命的假绿。
    ns = pyodide.globals.get('dict')();
    await pyodide.runPythonAsync(code, { globals: ns });
    self.postMessage({ type: 'result', runId, ok: true, stdout: out, error: null });
  } catch (err) {
    self.postMessage({
      type: 'result',
      runId,
      ok: false,
      stdout: out,
      error: String((err && err.message) || err),
    });
  } finally {
    if (ns) { try { ns.destroy(); } catch (e) { /* ignore */ } }
  }
};
