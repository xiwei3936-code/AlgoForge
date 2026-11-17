/* 存储探针的事件日志 —— 追加式，永远写。
 * ======================================================================
 * 为什么要有它（自动快照已经存在了，为什么还要这个）：
 *
 * 快照有三条"保命规则"，其中第一条是**内容为空就不写**（防止归零之后一开程序，
 * 反手把仅有的好快照挤掉）。这条规则救过数据，但它同时制造了一个**观测盲区**：
 * 「这一次打开时数据是空的」恰恰是最需要留下证据的时刻，而快照那边什么都不写。
 * 于是磁盘上"没有新快照"这件事是**二义**的 —— 可能是程序没打开过，
 * 也可能是打开了但数据没了。排查时这两者必须能分开。
 *
 * 所以这里另开一条**极小的、无条件写**的记录：每次打开、每次关窗口各一行 JSON。
 * 一行大约 300 字节，一千次开关也就 300KB。
 *
 * 【绝对不记内容】只记键名、键数、字节数。用户的代码和笔记一个字都不进这个文件 ——
 * 它是要被贴到聊天窗口里给人看的，写进去就是把人家的东西泄出去。
 *
 * 存到和快照同一个文件夹（默认 <程序根>\backup\），文件名 hot100-events.log。
 * 刻意**不叫** hot100-snapshot-*：快照轮换只删那个模式的文件，这个文件永远不会被它碰到。
 * ====================================================================== */
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const EVENT_LOG_NAME = 'hot100-events.log';
/** 超过就把老的截掉。够记几千次开关，又不会有人某天发现一个几百 MB 的日志。 */
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** 截断时保留最后这么多行 */
export const KEEP_LINES = 2000;
/** 单个事件的原始 JSON 上限。探针本来就该是小东西，超了说明有人乱塞。
 *  给到 32KB 而不是刚好够用：页面那侧已经把键名截到 60 个（src/probe.js 的 trimKeys），
 *  这里留出的余量是为了**宁可记下也不要 413** —— 丢掉的偏偏会是"键最多"那些条。 */
export const MAX_EVENT_BYTES = 32 * 1024;

export const PHASES = new Set(['boot', 'hide', 'manual']);

export function eventLogPath(dir) {
  return join(dir, EVENT_LOG_NAME);
}

/**
 * 把页面交上来的东西**削**成一条可以落盘的记录。
 * 这是白名单：没在这里列出的字段一律丢掉。
 * 页面那侧是可以被任意 JS 调用的（本机服务，同源脚本都能 POST），
 * 白名单式裁剪比"检查有没有坏字段"可靠。
 */
export function sanitizeEvent(raw, now = new Date()) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const phase = PHASES.has(src.phase) ? src.phase : 'boot';

  const ls = (src.ls && typeof src.ls === 'object') ? src.ls : {};

  const out = {
    at: now.toISOString(),
    phase,
    // 这一次打开/关闭时 localStorage 的规模
    n: clampInt(ls.n, 0, 100000),
    bytes: clampInt(ls.bytes, 0, 1024 * 1024 * 1024),
    // 键的**分类摘要**，不是键名列表 —— 见 src/probe.js 的 summarizeKeys。
    // 老版本页面交上来的是一个数组，这里也认，直接照旧截断，别让老日志读不出来。
    keys: sanitizeKeys(ls.keys),
    // ★ 探针本体：上一次会话留下的标记还在不在。
    //   在 = localStorage 确实落过盘；不在 = 整个 localStorage 活不过关闭。
    probe: sanitizeProbe(src.probe),
    // 存储配额（查"磁盘紧张导致驱逐"这一条）
    usage: clampInt(src.usage, 0, Number.MAX_SAFE_INTEGER),
    quota: clampInt(src.quota, 0, Number.MAX_SAFE_INTEGER),
    // navigator.storage.persisted()：这个源的存储是不是"持久"的
    persisted: src.persisted === true ? true : (src.persisted === false ? false : null),
    // 浏览器版本：换了版本行为变了要能看出来
    ua: typeof src.ua === 'string' ? src.ua.slice(0, 120) : '',
    origin: typeof src.origin === 'string' ? src.origin.slice(0, 120) : '',
    // ⚠ 白名单是**削**，不是校验：没在这里列出来的字段一律丢掉。
    //   所以页面那侧每加一个字段，这里必须同步加一条，否则它会被静默丢掉 ——
    //   而"静默丢掉"这件事在日志里长得跟"页面没报"一模一样，事后分不出来。
    v: typeof src.v === 'string' ? src.v.slice(0, 20) : '',      // 应用版本，跨版本对账用
    tz: clampInt(src.tz, -840, 840),                             // 时区偏移（分钟），at 是 UTC
  };
  return out;
}

/** 键的分类摘要。也兼容老页面交上来的字符串数组（升级期间两种会并存）。 */
function sanitizeKeys(raw) {
  if (Array.isArray(raw)) {
    // 老格式：一串键名。照旧截断，保证老日志、老页面都还读得动。
    return raw.filter((k) => typeof k === 'string').slice(0, 60).map((k) => k.slice(0, 80));
  }
  const k = (raw && typeof raw === 'object') ? raw : {};
  const other = Array.isArray(k.other) ? k.other : [];
  return {
    code: clampInt(k.code, 0, 100000),
    codeJava: clampInt(k.codeJava, 0, 100000),
    note: clampInt(k.note, 0, 100000),
    // other 里只该是固定的那几个键名（见 src/probe.js 的 NAMED_KEYS），给个宽松上限兜底
    other: other.filter((x) => typeof x === 'string').slice(0, 20).map((x) => x.slice(0, 40)),
  };
}

function sanitizeProbe(p) {
  // 三种状态要分得开：
  //   null    —— 页面没报（老版本）
  //   'gone'  —— 上一次写过标记，这次读不到了
  //   {...}   —— 读到了，附上它是哪一次会话写的
  if (p === null || p === undefined) return null;
  if (p === 'gone' || p === false) return 'gone';
  if (typeof p !== 'object') return null;
  return {
    seq: clampInt(p.seq, 0, 1e9),
    at: typeof p.at === 'string' ? p.at.slice(0, 40) : '',
  };
}

function clampInt(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** 一条记录 -> 一行（JSONL）。行内绝不能有裸换行，否则一行就变多行。 */
export function formatLine(event) {
  return JSON.stringify(event).replace(/[\r\n]/g, ' ') + '\n';
}

/**
 * 追加一条。**任何失败都只是返回 ok:false，绝不抛** ——
 * 它是排查用的旁路，不能因为磁盘满了就把程序拖垮。
 */
export function appendEvent(dir, raw, { now = new Date(), maxBytes = MAX_LOG_BYTES } = {}) {
  const event = sanitizeEvent(raw, now);
  const line = formatLine(event);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const p = eventLogPath(dir);
    // 先截断再写：这样刚写进去的这条一定还在
    trimIfHuge(p, maxBytes);
    appendFileSync(p, line, 'utf8');
    return { ok: true, event };
  } catch (e) {
    return { ok: false, message: String((e && e.message) || e), event };
  }
}

/** 截断必须**按字节**算，不能只按行数。
 *  只写"保留最后 N 行"的话，行一变大（比如以后往事件里多塞几个字段）就再也截不动了 ——
 *  日志会一直长下去，而这种失效是完全无声的。这里两个上限都守：行数不超过 KEEP_LINES，
 *  同时总字节压到上限的一半以下（留出余量，免得每写一条都要重写整个文件）。 */
function trimIfHuge(p, maxBytes) {
  try {
    if (!existsSync(p)) return;
    if (statSync(p).size <= maxBytes) return;
    const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
    const target = Math.floor(maxBytes / 2);
    const kept = [];
    let bytes = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const size = Buffer.byteLength(lines[i], 'utf8') + 1;
      if (kept.length >= KEEP_LINES || (kept.length > 0 && bytes + size > target)) break;
      bytes += size;
      kept.push(lines[i]);
    }
    kept.reverse();
    writeFileSync(p, kept.join('\n') + '\n', 'utf8');
  } catch { /* 截不动就让它继续长，比丢记录好 */ }
}

/** 读回来（给测试和"复制诊断信息"用）。坏行跳过，不让一行坏掉的 JSON 毁掉整份日志。 */
export function readEvents(dir, { limit = 200 } = {}) {
  const p = eventLogPath(dir);
  if (!existsSync(p)) return [];
  let text = '';
  try { text = readFileSync(p, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* 跳过坏行 */ }
  }
  return out.slice(-limit);
}
