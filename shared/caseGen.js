/* 随机用例生成器（对拍 + 效率测试）
 * ==================================================================
 * 为什么要有它：每道题原来只有 2~3 个示例 + 约 5 条隐藏用例。隐藏用例是**人预想到的**错误写法，
 * 想到的都能抓住，没想到的就漏过去。力扣每题有几十上百条用例，大头是程序生成的随机数据，还会测时间。
 * 这里照同样的思路给每道题生成两样东西：
 *   · 几百组**小**数据（数组长度 0~10、数值范围也小）—— 对拍用，存进题库，标 random: true
 *       绝大多数 bug 在小数据上就会出现；范围小，重复、全相同、全负数这些组合自然会被撞到；
 *       找到的错误输入也短，学生一眼看得懂
 *   · 一组按力扣数据范围上限的**大**数据 —— 效率测试用，**不存进题库**，判题时按固定种子现场生成
 *
 * 每道题的生成器按题型分在 shared/gen/*.js 里；这个文件只负责合起来、对外提供接口。
 *
 * 答案**不在这里算**：只生成 input，expected 由 scripts/verify.mjs 用 CPython 跑参考解算出，
 * 再由 verify-java.mjs 拿 Java 参考解和对抗版正确解交叉核对 —— 和隐藏用例同一条纪律。
 * 同一个种子永远生成同一批数据（自带 PRNG，不用 Math.random）：重新跑 verify.mjs 结果不变，diff 干净。
 *
 * ⚠ 每个生成器都必须守住力扣题面的数据范围与前提（两数之和恰好一组解、乘积装得进 32 位……），
 *   否则就成了冤枉人的用例。scripts/case-constraints.mjs 逐组检查。
 *
 * 必须保持纯净（不碰 DOM、不碰 node 内置模块）：浏览器和 Node 两边都要 import。
 */
import { makeRng, seedOf, treeToLevel } from './gen/util.js';
import * as arrays from './gen/arrays.js';
import * as strings from './gen/strings.js';
import * as lists from './gen/lists.js';
import * as trees from './gen/trees.js';
import * as matrix from './gen/matrix.js';
import * as design from './gen/design.js';
import * as dp from './gen/dp.js';
import * as backtrack from './gen/backtrack.js';

export { makeRng, seedOf, treeToLevel };

const PARTS = [arrays, strings, dp, backtrack, lists, trees, matrix, design];
function merge(key) {
  const out = {};
  for (const part of PARTS) {
    for (const [id, g] of Object.entries(part[key] || {})) {
      if (out[id]) throw new Error(`shared/gen 里 ${id} 的 ${key} 定义了两次`);
      out[id] = g;
    }
  }
  return out;
}

/** 每道题的小数据生成器：{ why, small(rng) }，或者输入空间很小时 { why, all() }（全部列出） */
export const GENERATORS = merge('GEN');
/** 每道题的效率测试生成器：{ why, make(rng), python?: { why, make(rng) } } */
export const PERF = merge('PERF');

/** 每道题生成多少组随机小数据 */
export const RANDOM_COUNT = 300;

/**
 * 给一道题生成随机小数据（只有 input）。existing 是已有用例的 input，用来去重。
 * 没有生成器的题返回 []。
 */
export function genRandomCases(id, existing = [], count = RANDOM_COUNT) {
  const g = GENERATORS[id];
  if (!g) return [];
  const seen = new Set(existing.map((x) => JSON.stringify(x)));
  // 输入空间很小（爬楼梯 n = 1~20、N 皇后 n = 1~9……）：全部列出来，比随机抽更全
  if (g.all) return g.all().filter((x) => !seen.has(JSON.stringify(x)));
  const rng = makeRng(seedOf(id));
  const out = [];
  for (let tries = 0; out.length < count && tries < count * 50; tries++) {
    const input = g.small(rng);
    if (!input) continue;
    const key = JSON.stringify(input);
    if (seen.has(key)) continue;          // 小数据空间有限，重复的不要
    seen.add(key);
    out.push(input);
  }
  return out;
}

/* ---------------- 效率测试 ----------------
 * 输入不存进题库（一组几百 KB 到几 MB），只存答案：判题时现场生成 ——
 * 浏览器里给 Python 用、服务端给 Java 用，调的是同一个函数、同一个种子，两种语言测的是同一份数据。
 * 少数题 Python 用小一些的规模（PERF[id].python）：力扣给 Python 的时限本来就宽，
 * 按 Java 的上限出题，连参考解在浏览器 Python 里都要跑好几秒（比如三数之和 n = 3000）。 */

/** 这道题、这门语言用哪一份效率测试的生成器 */
function perfGen(id, lang) {
  const g = PERF[id];
  if (!g) return null;
  return lang === 'python' && g.python ? g.python : g;
}

/** 某道题的效率测试输入（每次调用都生成同一份）；没有的返回 null */
export function genPerfInput(id, lang = 'java') {
  const g = perfGen(id, lang);
  return g ? g.make(makeRng(seedOf(id) ^ 0x9e3779b9)) : null;
}

/** 题库里这门语言的那份效率测试答案：{ why, expected } 或 { why, digest } */
export function perfSpecFor(problem, lang = 'java') {
  const p = problem && problem.perf;
  if (!p) return null;
  return lang === 'python' && p.python ? p.python : p;
}

/** 题库里的答案（或摘要）+ 现场生成的输入 → 一条判题用例。没有效率测试的题返回 null */
export function perfCaseFor(problem, lang = 'java') {
  const spec = perfSpecFor(problem, lang);
  if (!spec) return null;
  const input = genPerfInput(problem.id, lang);
  if (!input) return null;
  const digest = typeof spec.digest === 'string';
  return { input, expected: digest ? spec.digest : spec.expected, digest };
}

/**
 * 答案太大时只存摘要：摘要 = 这里的「规范 JSON」的 SHA-256 前 16 位。
 * 规则（Python 的 src/judge.js、Java 的 Hot100Judge 必须一模一样，scripts/test-perf.mjs 钉住三方一致）：
 *   · 无空格；整数值的浮点写成整数（3.0 -> 3）
 *   · unordered：把每个元素各自写成 JSON，按字符串排序后再拼起来（顺序无关）
 *   · set_of_sets：每一组先这样排一遍，再把各组按字符串排序
 * 按「字符串」排而不是按数值排：三种语言的字符串比较对 ASCII 是一致的，数值和字符串混排却各有各的规矩。
 */
export function canonicalJson(x, mode) {
  const js = (v) => JSON.stringify(v);
  const sortedArr = (arr, f) => '[' + arr.map(f).sort().join(',') + ']';
  if (mode === 'unordered' && Array.isArray(x)) return sortedArr(x, js);
  if (mode === 'set_of_sets' && Array.isArray(x)) return sortedArr(x, (g) => (Array.isArray(g) ? sortedArr(g, js) : js(g)));
  return js(x);
}

/* 效率测试的判定线（毫秒，只算学生代码本身的耗时）。
 * 用的是**绝对时间**，不是「比参考解慢几倍」：力扣按绝对时限判，
 * 两数之和的暴力解（n = 10^4）比哈希解慢上千倍，但在力扣上是能过的 —— 按倍数判会冤枉它。
 * 数值来自实测（docs/判题机制.md「效率测试」一节有完整表格）：
 *   参考解：Python（浏览器里）最慢 0.4 秒、Java 最慢 40 ms；
 *   力扣能过的慢一点的正确写法：Python 最慢 0.2 秒（O(n²) 的最长递增子序列）、Java 最慢 73 ms（O(n²) 的和为 K 的子数组）；
 *   力扣上会超时的朴素写法：Python 几十秒到几小时，Java 0.4 秒起（n = 10^5 的 O(n²)）。
 * ⚠ Java 跑简单循环太快：n = 10^5 的 O(n²) 只要 0.4~2 秒（JIT 还会预热、向量化），
 *   力扣判它超时是因为按**全部用例的总时间**算、大数据不止一组。所以 Java 的线压到 0.5 秒
 *   （第 1 批铺开时实测：朴素的每日温度 0.6 秒、退化的快速选择 0.4 秒，1 秒的线放过了它们）。
 * Python 的线放得宽：浏览器里的 Python 有时比电脑上装的慢几倍，而力扣对 Python 也宽松。 */
export const PERF_LIMITS = {
  python: { warn: 1000, fail: 10000 },
  java: { warn: 200, fail: 500 },
};

/** 'pass' 通过 / 'warn' 通过但提醒「力扣上可能超时」/ 'fail' 判不通过（力扣上会超时） */
export function perfVerdict(lang, ms, timedOut) {
  const L = PERF_LIMITS[lang];
  if (timedOut || !(ms >= 0) || ms > L.fail) return 'fail';
  return ms > L.warn ? 'warn' : 'pass';
}
