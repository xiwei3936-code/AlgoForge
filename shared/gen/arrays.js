/* 数组类题目的随机数据生成器
 * small(rng) —— 一组随机小数据（对拍用，存进题库）
 * PERF[id].make(rng) —— 效率测试的大数据（判题时现场生成）；有 python: {...} 的，Python 用那个规模
 * 键的顺序必须和方法参数顺序一致（判题按位置传参）。返回 null 表示这次没造成功，外面会重来。
 * 每个生成器都必须守住力扣题面的约束：scripts/case-constraints.mjs 逐组检查。 */
import { ints, INT_MIN, INT_MAX } from './util.js';

export const GEN = {
  'two-sum': {
    why: '小范围整数 → 大量重复值、负数、0；约 15% 用 ±10^9 附近的极值（int 相加会溢出）。每组恰好一组解',
    small(rng) {
      const n = rng.int(2, 8);
      const big = rng.chance(0.15);
      const pool = [-1000000000, 1000000000, 999999999, -999999999, 0, 1, -1, 500000000];   // 力扣：-10^9 <= nums[i] <= 10^9
      const nums = Array.from({ length: n }, () => (big ? rng.pick(pool) : rng.int(-6, 6)));
      const i = rng.int(0, n - 2);
      const j = rng.int(i + 1, n - 1);
      const target = nums[i] + nums[j];
      if (Math.abs(target) > 1e9) return null;                  // 力扣：-10^9 <= target <= 10^9
      let pairs = 0;
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (nums[a] + nums[b] === target) pairs++;
      if (pairs !== 1) return null;                              // 力扣：只会存在一个有效答案
      return { nums, target };
    },
  },

  'maximum-subarray': {
    why: '小范围（含全负数、全相同、单个元素）；约 10% 用 ±10^4 极值',
    small(rng) {
      const n = rng.int(1, 8);
      const mode = rng.int(0, 9);
      let gen;
      if (mode === 0) gen = () => rng.int(-5, -1);               // 全负数：best 初始化成 0 的写法会错
      else if (mode === 1) gen = () => rng.pick([-10000, 10000, -9999, 0]);
      else gen = () => rng.int(-5, 5);
      return { nums: Array.from({ length: n }, gen) };
    },
  },

  'container-with-most-water': {
    why: '长度 2~9，高度 0~6（大量相等、0 高度）；偶尔用 10^4 极值',
    small(rng) {
      const n = rng.int(2, 9);
      return { height: rng.chance(0.1) ? ints(rng, n, 9990, 10000) : ints(rng, n, 0, 6) };
    },
  },

  'move-zeroes': {
    why: '长度 1~9，约四成是 0（全 0、没有 0 都会出现）；偶尔混入 int 极值',
    small(rng) {
      const n = rng.int(1, 9);
      const zeroP = rng.pick([0, 0.4, 0.4, 1]);
      return { nums: Array.from({ length: n }, () => (rng.chance(zeroP) ? 0 : rng.chance(0.1) ? rng.pick([INT_MIN, INT_MAX]) : rng.int(-3, 3))) };
    },
  },

  '3sum': {
    why: '长度 3~9，元素在 [-4, 4]（大量和为 0 的三元组、大量重复值）；偶尔用 ±10^5 极值',
    small(rng) {
      const n = rng.int(3, 9);
      return { nums: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([-100000, 100000, 0, -50000, 50000])) : ints(rng, n, -4, 4) };
    },
  },

  'trapping-rain-water': {
    why: '长度 1~10，高度 0~5（平台、单调、坑套坑）；偶尔用 10^5 极值',
    small(rng) {
      const n = rng.int(1, 10);   // 力扣：1 <= n
      return { height: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([0, 100000, 99999])) : ints(rng, n, 0, 5) };
    },
  },

  'longest-consecutive-sequence': {
    why: '长度 0~10，元素在 [-3, 6]（重复、负数、多条序列）；偶尔用 ±10^9 边界附近的连续数',
    small(rng) {
      const n = rng.int(0, 10);
      if (rng.chance(0.15)) return { nums: Array.from({ length: n }, () => rng.pick([1000000000, 999999999, 999999998, -1000000000, -999999999, 0])) };
      return { nums: ints(rng, n, -3, 6) };
    },
  },

  'merge-intervals': {
    why: '1~6 个区间，起点 0~8、长度 0~3（重叠、首尾相接、包含、完全相同、长度为 0）；偶尔贴着 10^4 上界',
    small(rng) {
      const n = rng.int(1, 6);
      const hi = rng.chance(0.1) ? 10000 : 8;
      const intervals = Array.from({ length: n }, () => {
        const s = rng.int(Math.max(0, hi - 8), hi);
        return [s, Math.min(10000, s + rng.int(0, 3))];
      });
      return { intervals };
    },
  },

  'product-of-array-except-self': {
    why: '长度 2~8，元素在 [-3, 3]（含 0、多个 0、负数）；偶尔用 ±30',
    small(rng) {
      const n = rng.int(2, 8);
      const pool = rng.chance(0.1) ? [30, -30, 1, -1, 0] : [-3, -2, -1, 0, 1, 2, 3];
      // 力扣保证任意前缀 / 后缀的乘积都装得进 32 位整数：非零元素绝对值的总乘积不超过 INT_MAX 就一定满足
      let budget = 1;
      const nums = Array.from({ length: n }, () => {
        let v = rng.pick(pool);
        if (v !== 0 && budget * Math.abs(v) > INT_MAX) v = rng.pick([1, -1]);
        if (v !== 0) budget *= Math.abs(v);
        return v;
      });
      return { nums };
    },
  },

  'rotate-array': {
    why: '长度 1~8，k 在 0~20（k 大于长度、k 是长度的倍数）；偶尔混入 int 极值',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: Array.from({ length: n }, () => (rng.chance(0.1) ? rng.pick([INT_MIN, INT_MAX]) : rng.int(-9, 9))), k: rng.int(0, 20) };
    },
  },

  'sort-colors': {
    why: '长度 1~10，只有 0 / 1 / 2（某种颜色缺失、全是同一种）',
    small(rng) {
      const n = rng.int(1, 10);
      const colors = rng.pick([[0, 1, 2], [0, 1, 2], [0, 2], [1], [2, 1]]);
      return { nums: Array.from({ length: n }, () => rng.pick(colors)) };
    },
  },

  'subarray-sum-equals-k': {
    why: '长度 1~8，元素在 [-3, 3]（大量 0 和负数），k 在 [-5, 5]',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: ints(rng, n, -3, 3), k: rng.int(-5, 5) };
    },
  },

  'sliding-window-maximum': {
    why: '长度 1~9，k 在 1~n（k = 1、k = n），元素在 [-5, 5]',
    small(rng) {
      const n = rng.int(1, 9);
      return { nums: ints(rng, n, -5, 5), k: rng.int(1, n) };
    },
  },

  'single-number': {
    why: '0~4 对数 + 1 个单独的数，打乱顺序；值在 [-5, 5]，偶尔用 ±3·10^4',
    small(rng) {
      const pool = rng.chance(0.1) ? [-30000, 30000, 29999, -29999, 0, 1] : [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
      rng.shuffle(pool);
      const pairs = rng.int(0, Math.min(4, pool.length - 1));
      const nums = [pool[pairs]];
      for (let k = 0; k < pairs; k++) nums.push(pool[k], pool[k]);
      return { nums: rng.shuffle(nums) };
    },
  },

  'majority-element': {
    why: '长度 1~9，多数元素刚好过半或占绝大多数；其余元素随机（可能和多数元素相邻）',
    small(rng) {
      const n = rng.int(1, 9);
      const maj = rng.chance(0.1) ? rng.pick([1000000000, -1000000000]) : rng.int(-3, 3);
      const cnt = rng.int(Math.floor(n / 2) + 1, n);
      const nums = Array(cnt).fill(maj);
      while (nums.length < n) { const v = rng.int(-3, 3); if (v !== maj) nums.push(v); }
      return { nums: rng.shuffle(nums) };
    },
  },

  'find-the-duplicate-number': {
    why: 'n = 1~8，重复的数出现 2 次到 n+1 次，其余数各不相同',
    small(rng) {
      const n = rng.int(1, 8);
      const dup = rng.int(1, n);
      const others = rng.shuffle(Array.from({ length: n }, (_, k) => k + 1).filter((v) => v !== dup));
      const cnt = rng.int(2, n + 1);
      const nums = Array(cnt).fill(dup).concat(others.slice(0, n + 1 - cnt));
      return { nums: rng.shuffle(nums) };
    },
  },

  'find-first-and-last-position-of-element-in-sorted-array': {
    why: '长度 0~8 的非递减数组，值在 [-3, 3]（大段重复）；target 在 [-4, 4]（不在数组里、在两头、整段都是）；偶尔用 ±10^9',
    small(rng) {
      const n = rng.int(0, 8);
      if (rng.chance(0.1)) {
        const nums = Array.from({ length: n }, () => rng.pick([-1000000000, 0, 1000000000])).sort((a, b) => a - b);
        return { nums, target: rng.pick([-1000000000, 0, 1000000000, 1]) };
      }
      return { nums: ints(rng, n, -3, 3).sort((a, b) => a - b), target: rng.int(-4, 4) };
    },
  },

  'search-insert-position': {
    why: '长度 1~8 的严格递增数组，值在 [-10, 10]；target 在 [-12, 12]（比所有数都小 / 都大 / 正好命中）；偶尔用 ±10^4',
    small(rng) {
      const n = rng.int(1, 8);
      const edge = rng.chance(0.1);
      const pool = edge ? [-10000, -9999, 0, 9999, 10000] : Array.from({ length: 21 }, (_, k) => k - 10);
      const nums = rng.shuffle(pool.slice()).slice(0, Math.min(n, pool.length)).sort((a, b) => a - b);
      return { nums, target: edge ? rng.pick([-10000, -9998, 1, 9998, 10000]) : rng.int(-12, 12) };
    },
  },

  'daily-temperatures': {
    why: '长度 1~9，温度在 30~34（大量相同温度、单调递增 / 递减）；偶尔用 30~100',
    small(rng) {
      const n = rng.int(1, 9);
      return { temperatures: rng.chance(0.1) ? ints(rng, n, 30, 100) : ints(rng, n, 30, 34) };
    },
  },

  'find-minimum-in-rotated-sorted-array': {
    why: '长度 1~8、元素互不相同的升序数组，随机旋转 0~n-1 位（没旋转、只转一位）；偶尔用 ±5000',
    small(rng) {
      const n = rng.int(1, 8);
      const pool = rng.chance(0.1) ? [-5000, -4999, 0, 4999, 5000, 1, -1, 2] : Array.from({ length: 19 }, (_, k) => k - 9);
      const sorted = rng.shuffle(pool.slice()).slice(0, n).sort((a, b) => a - b);
      const r = rng.int(0, n - 1);
      return { nums: sorted.slice(r).concat(sorted.slice(0, r)) };
    },
  },

  'search-in-rotated-sorted-array': {
    why: '长度 1~8、元素互不相同的升序数组随机旋转；target 多半在数组里（两段的头尾），也有不在的',
    small(rng) {
      const n = rng.int(1, 8);
      const sorted = rng.shuffle(Array.from({ length: 21 }, (_, k) => k - 10)).slice(0, n).sort((a, b) => a - b);
      const r = rng.int(0, n - 1);
      const nums = sorted.slice(r).concat(sorted.slice(0, r));
      return { nums, target: rng.chance(0.7) ? rng.pick(nums) : rng.int(-11, 11) };
    },
  },

  'largest-rectangle-in-histogram': {
    why: '长度 1~9，高度 0~4（相等的高度、0 高度、单调）；偶尔用 10^4',
    small(rng) {
      const n = rng.int(1, 9);
      return { heights: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([0, 10000, 9999])) : ints(rng, n, 0, 4) };
    },
  },

  'median-of-two-sorted-arrays': {
    why: '两个长度 0~5 的有序数组（一个为空、总长奇 / 偶、两数组区间交错或完全分开、大量重复）；偶尔用 ±10^6',
    small(rng) {
      const m = rng.int(0, 5);
      const n = rng.int(m === 0 ? 1 : 0, 5);
      const v = rng.chance(0.1) ? () => rng.pick([-1000000, 1000000, 0]) : () => rng.int(-5, 5);
      const a = Array.from({ length: m }, v).sort((x, y) => x - y);
      const b = Array.from({ length: n }, v).sort((x, y) => x - y);
      return { nums1: a, nums2: b };
    },
  },

  'kth-largest-element-in-an-array': {
    why: '长度 1~9，值在 [-3, 3]（大量重复，重复的各占一个名次），k 在 1~n',
    small(rng) {
      const n = rng.int(1, 9);
      return { nums: ints(rng, n, -3, 3), k: rng.int(1, n) };
    },
  },

  'next-permutation': {
    why: '长度 1~6，值在 0~3（大量重复：已经是最大排列、只差最后两位）；偶尔用 100',
    small(rng) {
      const n = rng.int(1, 6);
      return { nums: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([0, 100, 99])) : ints(rng, n, 0, 3) };
    },
  },

  'top-k-frequent-elements': {
    why: '长度 1~10，值在 [-3, 3]，k 在 1~不同数字个数；只保留前 k 名唯一确定的（第 k 名和第 k+1 名次数不同）',
    small(rng) {
      const n = rng.int(1, 10);
      const nums = rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([-10000, 10000, 0])) : ints(rng, n, -3, 3);
      const freq = new Map();
      for (const x of nums) freq.set(x, (freq.get(x) || 0) + 1);
      const cnt = [...freq.values()].sort((a, b) => b - a);
      const k = rng.int(1, cnt.length);
      if (k < cnt.length && cnt[k - 1] === cnt[k]) return null;   // 力扣保证答案唯一
      return { nums, k };
    },
  },

  'first-missing-positive': {
    why: '长度 1~8，值在 [-2, 6]（重复、0、负数、1~n 刚好齐全）；偶尔混入 int 极值',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: Array.from({ length: n }, () => (rng.chance(0.1) ? rng.pick([INT_MIN, INT_MAX, 2147483646]) : rng.int(-2, 6))) };
    },
  },

  'best-time-to-buy-and-sell-stock': {
    why: '长度 1~8，价格 0~6（一路下跌、一路上涨、最低点在最后）；偶尔用 10^4',
    small(rng) {
      const n = rng.int(1, 8);
      return { prices: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([0, 10000])) : ints(rng, n, 0, 6) };
    },
  },

  'jump-game': {
    why: '长度 1~8，步数 0~3（大量 0：卡在半路、0 在最后一格不影响）；偶尔用 10^5',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: Array.from({ length: n }, () => (rng.chance(0.05) ? 100000 : rng.int(0, 3))) };
    },
  },

  'jump-game-ii': {
    why: '长度 1~8，步数 0~3（必须绕过 0、一步就能到终点）；只保留一定能到终点的',
    small(rng) {
      const n = rng.int(1, 8);
      const nums = Array.from({ length: n }, () => (rng.chance(0.05) ? 1000 : rng.int(0, 3)));
      let reach = 0;
      for (let i = 0; i < n - 1; i++) { if (i > reach) return null; reach = Math.max(reach, i + nums[i]); }
      return reach >= n - 1 ? { nums } : null;                  // 力扣保证一定能到
    },
  },
};

export const PERF = {
  'two-sum': {
    why: 'n = 10^4（上限），唯一解放在最后两个位置',
    make(rng) {
      const n = 10000;
      const vals = new Set();
      while (vals.size < n) vals.add(rng.int(-500000000, 500000000));
      const nums = rng.shuffle([...vals]);
      const target = nums[n - 2] + nums[n - 1];
      // 保证恰好一组解：别的数要是能和谁凑成 target，就换掉它
      for (;;) {
        const pos = new Map(nums.map((v, k) => [v, k]));
        let clash = -1;
        for (let k = 0; k < n - 2 && clash < 0; k++) {
          const j = pos.get(target - nums[k]);
          if (j !== undefined && j !== k) clash = k;
        }
        if (clash < 0) break;
        let v;
        do v = rng.int(-500000000, 500000000); while (pos.has(v) || pos.has(target - v));
        nums[clash] = v;
      }
      return { nums, target };
    },
  },
  'maximum-subarray': {
    why: 'n = 10^5（上限），元素在 [-10^4, 10^4] 随机',
    make(rng) { return { nums: Array.from({ length: 100000 }, () => rng.int(-10000, 10000)) }; },
  },
  'container-with-most-water': {
    why: 'n = 10^5（上限），高度在 [0, 10^4] 随机',
    make(rng) { return { height: ints(rng, 100000, 0, 10000) }; },
  },
  'move-zeroes': {
    why: 'n = 10^4（上限），一半是 0',
    make(rng) { return { nums: Array.from({ length: 10000 }, () => (rng.chance(0.5) ? 0 : rng.int(INT_MIN, INT_MAX))) }; },
  },
  '3sum': {
    why: 'n = 3000（上限），元素在 [-10^5, 10^5] 随机',
    make(rng) { return { nums: ints(rng, 3000, -100000, 100000) }; },
    // 标准的 O(n²) 解在浏览器 Python 里 n = 3000 要 0.5 秒（实测），离「偏慢」的线太近；O(n³) 在 1500 上照样要跑几分钟
    python: { why: 'n = 1500（Python 用上限的一半：力扣给 Python 的时限本来就宽），元素在 [-10^5, 10^5] 随机', make(rng) { return { nums: ints(rng, 1500, -100000, 100000) }; } },
  },
  'trapping-rain-water': {
    why: 'n = 2·10^4（上限），高度在 [0, 10^5] 随机',
    make(rng) { return { height: ints(rng, 20000, 0, 100000) }; },
  },
  'longest-consecutive-sequence': {
    why: 'n = 10^5（上限），几段很长的连续数打散了混在随机大数里',
    make(rng) {
      const nums = [];
      for (let run = 0; run < 5; run++) { const s = rng.int(-900000000, 900000000); for (let k = 0; k < 10000; k++) nums.push(s + k); }
      while (nums.length < 100000) nums.push(rng.int(-1000000000, 1000000000));
      return { nums: rng.shuffle(nums) };
    },
  },
  'merge-intervals': {
    why: '10^4 个区间（上限），起点在 [0, 10^4]、长度 0~50',
    make(rng) {
      return { intervals: Array.from({ length: 10000 }, () => { const s = rng.int(0, 10000); return [s, Math.min(10000, s + rng.int(0, 50))]; }) };
    },
  },
  'product-of-array-except-self': {
    why: 'n = 10^5（上限），绝大多数是 ±1，零星几个 2、3、30（保证前后缀乘积都装得进 32 位整数）',
    make(rng) {
      const nums = Array.from({ length: 100000 }, () => (rng.chance(0.5) ? 1 : -1));
      for (const v of [30, -30, 3, 2, -2]) nums[rng.int(0, nums.length - 1)] = v;   // 30·30·3·2·2 = 10800
      return { nums };
    },
  },
  'rotate-array': {
    why: 'n = 10^5、k 在 [0, 10^5]（上限）',
    make(rng) { return { nums: ints(rng, 100000, INT_MIN, INT_MAX), k: rng.int(50000, 100000) }; },
  },
  'subarray-sum-equals-k': {
    why: 'n = 2·10^4（上限），元素在 [-1000, 1000]，k 取某一段的和',
    make(rng) {
      const nums = ints(rng, 20000, -1000, 1000);
      const a = rng.int(0, 19000);
      let k = 0;
      for (let i = a; i < a + 500; i++) k += nums[i];
      return { nums, k };
    },
  },
  'sliding-window-maximum': {
    why: 'n = 10^5（上限），k = 5·10^4',
    make(rng) { return { nums: ints(rng, 100000, -10000, 10000), k: 50000 }; },
  },
  'single-number': {
    why: 'n = 29999（上限内最长的奇数长度），14999 对数 + 1 个单独的数',
    make(rng) {
      const vals = new Set();
      while (vals.size < 15000) vals.add(rng.int(-30000, 30000));
      const v = [...vals];
      const nums = [v[0]];
      for (let k = 1; k < v.length; k++) nums.push(v[k], v[k]);
      return { nums: rng.shuffle(nums) };
    },
  },
  'majority-element': {
    why: 'n = 5·10^4（上限），多数元素刚好过半',
    make(rng) {
      const n = 50000;
      const maj = rng.int(-1000000000, 1000000000);
      const nums = Array(n / 2 + 1).fill(maj);
      while (nums.length < n) { const v = rng.int(-1000000000, 1000000000); if (v !== maj) nums.push(v); }
      return { nums: rng.shuffle(nums) };
    },
  },
  'find-the-duplicate-number': {
    why: 'n = 10^5（上限），重复的数出现 2 次',
    make(rng) {
      const n = 99999;
      const nums = Array.from({ length: n }, (_, k) => k + 1);
      nums.push(rng.int(1, n));
      return { nums: rng.shuffle(nums) };
    },
  },

  'daily-temperatures': {
    why: 'n = 10^5（上限）：温度一路只降不升，直到最后一天才回到 100 —— 每一天都要等到最后一天（逐天往后找的写法是 O(n²)）',
    make() {
      const t = Array.from({ length: 99999 }, (_, k) => 99 - Math.floor(k / 1429));   // 99 一路降到 30
      t.push(100);
      return { temperatures: t };
    },
  },
  'largest-rectangle-in-histogram': {
    why: 'n = 10^5（上限），高度只增不减（随机高度排好序）—— 每根柱子往右都能一直扩到头（逐根往两边扩的写法是 O(n²)）',
    make(rng) { return { heights: ints(rng, 100000, 0, 10000).sort((a, b) => a - b) }; },
  },
  'kth-largest-element-in-an-array': {
    why: 'n = 10^5（上限），99% 是同一个数（朴素的快速选择会退化成 O(n²)），k = 5·10^4',
    make(rng) { return { nums: Array.from({ length: 100000 }, () => (rng.chance(0.99) ? 7 : rng.int(-10000, 10000))), k: 50000 }; },
  },
  'top-k-frequent-elements': {
    why: 'n = 10^5（上限），2000 个不同的数，k = 100（前 100 名的次数 200~299 各不相同，其余每个数 39~40 次）',
    make(rng) {
      const vals = new Set();
      while (vals.size < 2000) vals.add(rng.int(-10000, 10000));
      const v = [...vals];
      const nums = [];
      for (let i = 0; i < 100; i++) for (let c = 0; c < 200 + i; c++) nums.push(v[i]);
      for (let i = 100; nums.length < 100000; i = i + 1 < v.length ? i + 1 : 100) nums.push(v[i]);
      return { nums: rng.shuffle(nums), k: 100 };
    },
  },
  'first-missing-positive': {
    why: 'n = 10^5（上限）：1~10^5 去掉一个数再混进一个负数，打乱',
    make(rng) {
      const miss = rng.int(1, 100000);
      const nums = [];
      for (let v = 1; v <= 100000; v++) if (v !== miss) nums.push(v);
      nums.push(-5);
      return { nums: rng.shuffle(nums) };
    },
  },
  'best-time-to-buy-and-sell-stock': {
    why: 'n = 10^5（上限），价格在 [0, 10^4] 随机',
    make(rng) { return { prices: ints(rng, 100000, 0, 10000) }; },
  },
  'jump-game': {
    why: 'n = 10^4（上限）：每一格都刚好只能跳到倒数第二格（那里是 0），答案是 false —— 朴素的逐格递推要把每一步都试一遍',
    make() { const n = 10000; return { nums: Array.from({ length: n }, (_, i) => Math.max(0, n - 2 - i)) }; },
  },
  'jump-game-ii': {
    why: 'n = 10^4（上限），步数在 [1, 1000] 随机',
    make(rng) { return { nums: ints(rng, 10000, 1, 1000) }; },
  },
};
