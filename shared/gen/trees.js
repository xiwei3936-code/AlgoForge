/* 树类题目的随机数据生成器（约定同 arrays.js）
 * 树都用层序数组表示（和力扣一样）。效率测试这一批几乎不出：力扣给的规模大多很小（中序遍历 100、翻转 100……），
 * 或者朴素写法本来就是 O(n)。大一点的树一律用随机形状（深度只有几十层），
 * 不出一万层的链状树 —— 能不能递归到那么深取决于运行环境的设置，见 shared/gen/lists.js 开头的说明。 */
import { randomShape, inorder, treeToLevel, INT_MIN, INT_MAX } from './util.js';

/** 随机形状 + 随机值（值在 [lo, hi]，可以重复） */
function valTree(rng, n, lo, hi) {
  const root = randomShape(rng, n);
  for (const node of inorder(root)) node.v = rng.int(lo, hi);
  return root;
}
/** 随机形状 + 互不相同的值（从 pool 里抽） */
function distinctTree(rng, n, pool) {
  const root = randomShape(rng, n);
  const vals = rng.shuffle(pool.slice());
  inorder(root).forEach((node, k) => { node.v = vals[k]; });
  return root;
}
/** 一条随机往左或往右拐的链（最深的形状） */
function chainTree(rng, n, lo, hi) {
  let root = null, cur = null;
  for (let k = 0; k < n; k++) {
    const node = { v: rng.int(lo, hi), l: null, r: null };
    if (!root) root = node; else cur[rng.chance(0.5) ? 'l' : 'r'] = node;
    cur = node;
  }
  return root;
}
const mirror = (t) => (t ? { v: t.v, l: mirror(t.r), r: mirror(t.l) } : null);
function preorder(root, out = []) {
  const stack = root ? [root] : [];
  while (stack.length) { const n = stack.pop(); out.push(n.v); if (n.r) stack.push(n.r); if (n.l) stack.push(n.l); }
  return out;
}
const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);

export const GEN = {
  'validate-binary-search-tree': {
    why: '0~7 个结点的随机形状；先造一棵合法 BST，再按概率改坏一处（交换两值 / 造重复值 / 越过祖先的界）；值里混有 ±2^31 边界',
    small(rng) {
      const n = rng.int(0, 7);
      const root = randomShape(rng, n);
      const nodes = inorder(root);
      // 先按中序填严格递增的值 —— 这样是一棵合法的 BST
      const useEdge = rng.chance(0.2);
      const vals = new Set();
      while (vals.size < n) vals.add(useEdge ? rng.pick([INT_MIN, INT_MIN + 1, -1, 0, 1, INT_MAX - 1, INT_MAX]) : rng.int(-9, 9));
      const sorted = [...vals].sort((a, b) => a - b);
      nodes.forEach((node, k) => { node.v = sorted[k]; });
      if (n >= 2 && rng.chance(0.65)) {
        const kind = rng.int(0, 2);
        const a = rng.int(0, n - 1);
        let b = rng.int(0, n - 2); if (b >= a) b++;
        if (kind === 0) { const t = nodes[a].v; nodes[a].v = nodes[b].v; nodes[b].v = t; }   // 交换两值
        else if (kind === 1) nodes[a].v = nodes[b].v;                                       // 重复值
        else nodes[a].v = useEdge ? rng.pick([INT_MIN, INT_MAX]) : rng.int(-12, 12);       // 随便改一个（可能越过祖先的界）
      }
      return { root: treeToLevel(root) };
    },
  },

  'binary-tree-inorder-traversal': {
    why: '0~7 个结点的随机形状，值在 [-3, 3]（空树、只有左孩子 / 右孩子的链）',
    small(rng) { const n = rng.int(0, 7); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'maximum-depth-of-binary-tree': {
    why: '0~8 个结点的随机形状（约两成是往左右随机拐的链：最深的那种）',
    small(rng) { const n = rng.int(0, 8); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'diameter-of-binary-tree': {
    why: '1~8 个结点的随机形状（最长路径不经过根、只有一条链）',
    small(rng) { const n = rng.int(1, 8); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'invert-binary-tree': {
    why: '0~7 个结点的随机形状，值在 [-3, 3]',
    small(rng) { return { root: treeToLevel(valTree(rng, rng.int(0, 7), -3, 3)) }; },
  },

  'symmetric-tree': {
    why: '约一半是镜像对称的树（其中一部分再改坏一个值），其余随机（形状对称但值不对称、值对称但形状不对称都会出现）',
    small(rng) {
      const mode = rng.int(0, 9);
      if (mode < 5) {
        const half = valTree(rng, rng.int(0, 4), 1, 3);
        const root = { v: rng.int(1, 3), l: half, r: mirror(half) };
        if (mode >= 3) {   // 改坏一个值（可能恰好改成一样的，那就仍然对称）
          const nodes = inorder(root);
          rng.pick(nodes).v = rng.int(1, 3);
        }
        return { root: treeToLevel(root) };
      }
      return { root: treeToLevel(valTree(rng, rng.int(1, 7), 1, 2)) };
    },
  },

  'binary-tree-level-order-traversal': {
    why: '0~8 个结点的随机形状，值在 [-3, 3]（空树、很不对称的树）',
    small(rng) { const n = rng.int(0, 8); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'convert-sorted-array-to-binary-search-tree': {
    why: '长度 1~8 的严格递增数组，取自 [-9, 9]',
    small(rng) { return { nums: rng.shuffle(range(-9, 9)).slice(0, rng.int(1, 8)).sort((a, b) => a - b) }; },
  },

  'path-sum-iii': {
    why: '0~8 个结点，值在 [-3, 3]，targetSum 在 [-3, 3]（大量 0 和负数：同一条路上有多段都满足）；约一成用 ±10^9 的值（路径和超出 int）',
    small(rng) {
      const n = rng.int(0, 8);
      if (rng.chance(0.1)) {
        const root = randomShape(rng, n);
        for (const node of inorder(root)) node.v = rng.pick([1000000000, -1000000000, 294967296, 0]);
        return { root: treeToLevel(root), targetSum: rng.pick([0, -1000, 1000]) };
      }
      return { root: treeToLevel(valTree(rng, n, -3, 3)), targetSum: rng.int(-3, 3) };
    },
  },

  'binary-tree-right-side-view': {
    why: '0~8 个结点的随机形状（左子树比右子树深：右视图里会出现左边的结点）',
    small(rng) { const n = rng.int(0, 8); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'kth-smallest-element-in-a-bst': {
    why: '1~8 个结点的合法 BST（随机形状，值互不相同、取自 0~20），k 在 1~n',
    small(rng) {
      const n = rng.int(1, 8);
      const root = randomShape(rng, n);
      const vals = rng.shuffle(range(0, 20)).slice(0, n).sort((a, b) => a - b);
      inorder(root).forEach((node, k) => { node.v = vals[k]; });
      return { root: treeToLevel(root), k: rng.int(1, n) };
    },
  },

  'construct-binary-tree-from-preorder-and-inorder-traversal': {
    why: '1~8 个结点的随机形状，值互不相同（取自 [-5, 5]）；只有左孩子 / 只有右孩子的链也会出现',
    small(rng) {
      const n = rng.int(1, 8);
      const root = distinctTree(rng, n, range(-5, 5));
      return { preorder: preorder(root), inorder: inorder(root).map((x) => x.v) };
    },
  },

  'flatten-binary-tree-to-linked-list': {
    why: '0~8 个结点的随机形状，值在 [-3, 3]（空树、只有左孩子的链、已经是链）',
    small(rng) { const n = rng.int(0, 8); return { root: treeToLevel(rng.chance(0.2) ? chainTree(rng, n, -3, 3) : valTree(rng, n, -3, 3)) }; },
  },

  'binary-tree-maximum-path-sum': {
    why: '1~8 个结点，值在 [-5, 5]（约两成全是负数：答案是最大的那个负数）',
    small(rng) { const n = rng.int(1, 8); const allNeg = rng.chance(0.2); return { root: treeToLevel(valTree(rng, n, -5, allNeg ? -1 : 5)) }; },
  },

  'lowest-common-ancestor-of-a-binary-tree': {
    why: '2~8 个结点的随机形状，值互不相同（取自 [-5, 10]）；p、q 是任意两个不同的结点（含一个是另一个的祖先）',
    small(rng) {
      const n = rng.int(2, 8);
      const root = distinctTree(rng, n, range(-5, 10));
      const vals = rng.shuffle(inorder(root).map((x) => x.v));
      return { root: treeToLevel(root), p: { __node: vals[0] }, q: { __node: vals[1] } };
    },
  },
};

export const PERF = {
  'validate-binary-search-tree': {
    why: '10^4 个结点（上限）的合法 BST（随机插入顺序建出来的）—— 正确解必须把每个结点都看一遍',
    make(rng) {
      const vals = new Set();
      while (vals.size < 10000) vals.add(rng.int(INT_MIN, INT_MAX));
      let root = null;
      for (const v of vals) {
        const node = { v, l: null, r: null };
        if (!root) { root = node; continue; }
        let cur = root;
        for (;;) {
          const side = v < cur.v ? 'l' : 'r';
          if (!cur[side]) { cur[side] = node; break; }
          cur = cur[side];
        }
      }
      return { root: treeToLevel(root) };
    },
  },
};
