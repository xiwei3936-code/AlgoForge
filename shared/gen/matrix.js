/* 矩阵、网格、图类题目的随机数据生成器（约定同 arrays.js）
 * 效率测试给最小路径和（不带记忆的递归是指数级的）、岛屿数量、课程表出。别的题力扣给的规模本来就小
 * （螺旋矩阵 10×10、旋转图像 20×20……），或者暴力写法在力扣上也能过（两道搜索二维矩阵）。
 * 岛屿数量、课程表的常见写法是递归 DFS，等到 2026-10 在力扣上实测出递归能到多深、本地对齐之后才出
 * （见 docs/判题机制.md 的「递归深度」）。 */
import { ints, str } from './util.js';

const grid = (rng, m, n, cell) => Array.from({ length: m }, () => Array.from({ length: n }, cell));
/** 行、列都严格递增的矩阵 */
function youngMatrix(rng, m, n, start) {
  const a = grid(rng, m, n, () => 0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      const up = i > 0 ? a[i - 1][j] : start - 1;
      const left = j > 0 ? a[i][j - 1] : start - 1;
      a[i][j] = Math.max(up, left) + rng.int(1, 3);
    }
  }
  return a;
}

export const GEN = {
  'set-matrix-zeroes': {
    why: '1~4 × 1~4，约三成是 0（没有 0、全是 0、0 在第一行第一列）；偶尔混入 int 极值',
    small(rng) {
      const m = rng.int(1, 4), n = rng.int(1, 4), p = rng.pick([0, 0.3, 0.3, 0.6]);
      return { matrix: grid(rng, m, n, () => (rng.chance(p) ? 0 : rng.chance(0.1) ? rng.pick([-2147483648, 2147483647]) : rng.pick([-3, -2, -1, 1, 2, 3]))) };
    },
  },

  'spiral-matrix': {
    why: '1~5 × 1~5（只有一行、只有一列、长方形）',
    small(rng) { return { matrix: grid(rng, rng.int(1, 5), rng.int(1, 5), () => rng.int(-9, 9)) }; },
  },

  'rotate-image': {
    why: 'n = 1~5 的方阵',
    small(rng) { const n = rng.int(1, 5); return { matrix: grid(rng, n, n, () => rng.int(-9, 9)) }; },
  },

  'search-a-2d-matrix-ii': {
    why: '1~5 × 1~5、行列都严格递增的矩阵；target 多半在矩阵里（四个角、正中间），也有不在的（比所有数都小 / 都大、夹在中间）',
    small(rng) {
      const m = rng.int(1, 5), n = rng.int(1, 5);
      const matrix = youngMatrix(rng, m, n, rng.int(-5, 5));
      const flat = matrix.flat();
      return { matrix, target: rng.chance(0.6) ? rng.pick(flat) : rng.int(flat[0] - 2, flat[flat.length - 1] + 2) };
    },
  },

  'number-of-islands': {
    why: '1~5 × 1~5，陆地占一到七成（全是水、全是陆地、只有对角相邻的陆地）',
    small(rng) {
      const p = rng.pick([0.2, 0.5, 0.5, 0.7]);
      return { grid: grid(rng, rng.int(1, 5), rng.int(1, 5), () => (rng.chance(p) ? '1' : '0')) };
    },
  },

  'rotting-oranges': {
    why: '1~4 × 1~4，0 / 1 / 2 随机（没有新鲜橘子、没有腐烂橘子、有永远烂不到的橘子）',
    small(rng) { return { grid: grid(rng, rng.int(1, 4), rng.int(1, 4), () => rng.int(0, 2)) }; },
  },

  'course-schedule': {
    why: '1~6 门课、0~8 条先修关系（互不重复、不指向自己）：有环、无环、多个连通块、孤立的课',
    small(rng) {
      const n = rng.int(1, 6);
      const pairs = new Set();
      const want = n < 2 ? 0 : rng.int(0, Math.min(8, n * (n - 1)));
      while (pairs.size < want) {
        const a = rng.int(0, n - 1), b = rng.int(0, n - 1);
        if (a !== b) pairs.add(a + ',' + b);
      }
      return { numCourses: n, prerequisites: [...pairs].map((x) => x.split(',').map(Number)) };
    },
  },

  'word-search': {
    why: '1~4 × 1~4 的字母板、长 1~6 的单词，字母表很小（走回头路才能凑出、同一格不能用两次、大小写不同）',
    small(rng) {
      const alpha = rng.pick(['AB', 'ABC', 'aA', 'ABCD']);
      return { board: grid(rng, rng.int(1, 4), rng.int(1, 4), () => str(rng, 1, alpha)), word: str(rng, rng.int(1, 6), alpha) };
    },
  },

  'search-a-2d-matrix': {
    why: '1~4 × 1~4、按行展开后严格递增的矩阵；target 在不在都有（第一个、最后一个、两行之间的空档）',
    small(rng) {
      const m = rng.int(1, 4), n = rng.int(1, 4);
      let v = rng.int(-10, 0);
      const matrix = grid(rng, m, n, () => (v += rng.int(1, 3)));
      const flat = matrix.flat();
      return { matrix, target: rng.chance(0.5) ? rng.pick(flat) : rng.int(flat[0] - 2, flat[flat.length - 1] + 2) };
    },
  },

  'minimum-path-sum': {
    why: '1~5 × 1~5，格子里是 0~9（只有一行、只有一列、大量 0）',
    small(rng) { return { grid: grid(rng, rng.int(1, 5), rng.int(1, 5), () => rng.int(0, 9)) }; },
  },
};

export const PERF = {
  'minimum-path-sum': {
    why: '200 × 200（上限），格子里是 0~100 —— 不带记忆的递归是指数级的',
    make(rng) { return { grid: Array.from({ length: 200 }, () => ints(rng, 200, 0, 100)) }; },
  },
  'number-of-islands': {
    why: '300 × 300（上限）：左边 149 列连成一整块陆地（递归 DFS 要深 4 万多层，力扣上没问题），右边 150 列是棋盘格，22500 个小岛 —— 用列表记走过的格子（每次 in 都从头找）是平方级的',
    make() {
      return { grid: Array.from({ length: 300 }, (_, i) => Array.from({ length: 300 }, (_, j) => (j < 149 ? '1' : j === 149 ? '0' : (i + j) % 2 === 0 ? '1' : '0'))) };
    },
  },
  'course-schedule': {
    why: '2000 门课（上限）排成一条链，每门课都是后面第 1、第 2 门的先修课（3997 条先修关系，没有环，答案是 true）—— 不记「这门课已经查过没有环」的 DFS 要把所有路径走一遍，路径数是斐波那契级的；常见的递归 DFS 要深 2000 层（力扣上没问题）',
    make(rng) {
      const n = 2000;
      const order = Array.from({ length: n }, (_, i) => i);
      shuffle(rng, order);          // 课程编号打乱：按编号顺序处理碰巧是拓扑序的话，测不出来
      const pairs = [];
      for (let i = 0; i + 1 < n; i++) pairs.push([order[i + 1], order[i]]);   // [a, b]：学 a 之前要先学 b
      for (let i = 0; i + 2 < n; i++) pairs.push([order[i + 2], order[i]]);
      shuffle(rng, pairs);
      return { numCourses: n, prerequisites: pairs };
    },
  },
};

function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
