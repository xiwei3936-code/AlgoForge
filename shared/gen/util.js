/* 随机数据生成器的公共工具（shared/caseGen.js 和 shared/gen/*.js 共用）
 * 必须保持纯净：浏览器（给 Python 生成效率测试数据）和 Node（服务端、verify.mjs）两边都要 import。 */

/* ---------------- 可复现的随机数（mulberry32） ---------------- */
export function makeRng(seed) {
  let a = seed >>> 0;
  const float = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(float() * (hi - lo + 1));   // 闭区间 [lo, hi]
  return {
    float,
    int,
    chance: (p) => float() < p,
    pick: (arr) => arr[Math.floor(float() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = int(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; }
      return arr;
    },
  };
}

/** 题目 id → 种子（FNV-1a）。版本号变了，全部数据跟着换一批 */
const SEED_VERSION = 1;
export function seedOf(id) {
  let h = 0x811c9dc5 ^ SEED_VERSION;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;

/** n 个 [lo, hi] 里的随机整数 */
export const ints = (rng, n, lo, hi) => Array.from({ length: n }, () => rng.int(lo, hi));
/** n 个从 alphabet 里随机挑的字符拼成的串 */
export const str = (rng, n, alphabet) => { let s = ''; for (let k = 0; k < n; k++) s += alphabet[rng.int(0, alphabet.length - 1)]; return s; };
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* ---------------- 树 ---------------- */
/** 随机形状的二叉树（n 个结点），结点是 { v, l, r }，值先空着 */
export function randomShape(rng, n) {
  if (n <= 0) return null;
  const root = { v: null, l: null, r: null };
  const open = [[root, 'l'], [root, 'r']];          // 还空着的孩子位置
  for (let k = 1; k < n; k++) {
    const idx = rng.int(0, open.length - 1);
    const [parent, side] = open[idx];
    open.splice(idx, 1);
    const node = { v: null, l: null, r: null };
    parent[side] = node;
    open.push([node, 'l'], [node, 'r']);
  }
  return root;
}
export function inorder(root, out = []) {
  // 用显式栈：效率测试的树可能很深，递归会爆 JS 的调用栈
  const stack = [];
  let cur = root;
  while (cur || stack.length) {
    while (cur) { stack.push(cur); cur = cur.l; }
    cur = stack.pop();
    out.push(cur);
    cur = cur.r;
  }
  return out;
}
/** 树 → 力扣的层序数组（和 src/judge.js 的 array_to_tree 互逆：只展开非空结点的孩子，末尾的 null 去掉） */
export function treeToLevel(root) {
  if (!root) return [];
  const out = [];
  const q = [root];
  for (let i = 0; i < q.length; i++) {
    const n = q[i];
    if (n) { out.push(n.v); q.push(n.l, n.r); } else out.push(null);
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}
