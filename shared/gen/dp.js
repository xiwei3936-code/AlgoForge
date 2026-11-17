/* 动态规划类题目的随机数据生成器（约定同 arrays.js）
 * 有 all() 的：输入空间很小，直接全部列出来（比随机抽更全），不再随机。 */
import { ints, str, LOWER, INT_MAX } from './util.js';

/** 最长回文子串：所有最长回文的内容是不是只有一种（有多种时，「返回哪一个」本地和力扣的规矩可能不同，干脆不出这种数据） */
export function uniqueLongestPalindrome(s) {
  let best = 0;
  const found = new Set();
  const consider = (l, r) => {   // 从中心向两边扩，记录以这个中心最长的那一段
    while (l >= 0 && r < s.length && s[l] === s[r]) { l--; r++; }
    const len = r - l - 1;
    if (len > best) { best = len; found.clear(); }
    if (len === best && len > 0) found.add(s.slice(l + 1, r));
  };
  for (let c = 0; c < s.length; c++) { consider(c, c); consider(c, c + 1); }
  return found.size <= 1;
}

export const GEN = {
  'climbing-stairs': {
    why: 'n = 1~20 全部列出（再大朴素递归就跑不动了 —— 那是效率测试的事）',
    all: () => Array.from({ length: 20 }, (_, k) => ({ n: k + 1 })),
  },

  'house-robber': {
    why: '长度 1~9，金额 0~5（大量 0、相等的金额、隔两间更优）；偶尔用 400',
    small(rng) {
      const n = rng.int(1, 9);   // 力扣：1 <= n（本地题面允许空数组，按两边的交集来）
      return { nums: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([0, 400, 399])) : ints(rng, n, 0, 5) };
    },
  },

  'maximum-product-subarray': {
    why: '长度 1~8，元素在 [-3, 3]（0 把数组切开、偶数个负数、单个负数）；偶尔用 ±10',
    small(rng) {
      const n = rng.int(1, 8);
      const pool = rng.chance(0.1) ? [10, -10, 1, -1, 0, 2] : [-3, -2, -1, 0, 1, 2, 3];
      // 力扣保证任意子数组的乘积都装得进 32 位整数：非零元素绝对值的总乘积不超过 INT_MAX 就一定满足
      let budget = 1;
      return {
        nums: Array.from({ length: n }, () => {
          let v = rng.pick(pool);
          if (v !== 0 && budget * Math.abs(v) > INT_MAX) v = rng.pick([1, -1]);
          if (v !== 0) budget *= Math.abs(v);
          return v;
        }),
      };
    },
  },

  'pascals-triangle': {
    why: 'numRows = 1~30 全部列出',
    all: () => Array.from({ length: 30 }, (_, k) => ({ numRows: k + 1 })),
  },

  'coin-change': {
    why: '1~4 种面额（1~8），金额 0~20（凑不出、金额为 0、贪心会错）；偶尔混入 2^31-1 的大面额',
    small(rng) {
      const k = rng.int(1, 4);
      const coins = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]).slice(0, k);
      if (rng.chance(0.1)) coins[0] = INT_MAX;
      return { coins, amount: rng.int(0, 20) };
    },
  },

  'partition-equal-subset-sum': {
    why: '长度 1~8，元素 1~6（总和为奇数、只有一个数、能 / 不能平分）',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([100, 99, 1])) : ints(rng, n, 1, 6) };
    },
  },

  'perfect-squares': {
    why: 'n 在 1~1000 随机（本身是平方数、要 4 个平方数的 4^a(8b+7) 型）',
    small(rng) { return { n: rng.int(1, 1000) }; },
  },

  'word-break': {
    why: 's 长 1~10、词典 1~4 个词（长 1~3），都只用 a、b（大量重叠的拆法、拆到一半走不通）',
    small(rng) {
      const alpha = rng.pick(['ab', 'ab', 'abc']);
      const words = new Set();
      const k = rng.int(1, 4);
      while (words.size < k) words.add(str(rng, rng.int(1, 3), alpha));
      return { s: str(rng, rng.int(1, 10), alpha), wordDict: [...words] };
    },
  },

  'longest-increasing-subsequence': {
    why: '长度 1~8，元素在 [-3, 3]（相等的不算递增、整体递减）；偶尔用 ±10^4',
    small(rng) {
      const n = rng.int(1, 8);
      return { nums: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([-10000, 10000, 0])) : ints(rng, n, -3, 3) };
    },
  },

  'longest-valid-parentheses': {
    why: '长度 0~10，只有 ( 和 )（空串、全是左括号、合法段被一个多余的括号隔开）',
    small(rng) { return { s: str(rng, rng.int(0, 10), rng.pick(['()', '()', '((()', '()))'])) }; },
  },

  'longest-palindromic-substring': {
    why: '长度 1~8，字母表很小（回文套回文、偶数长度、整串都是）；只保留最长回文唯一的',
    small(rng) {
      const s = str(rng, rng.int(1, 8), rng.pick(['ab', 'ab', 'abc', 'aA1']));
      return uniqueLongestPalindrome(s) ? { s } : null;
    },
  },

  'unique-paths': {
    why: 'm、n = 1~10 全部组合列出（再大朴素递归就跑不动了 —— 那是效率测试的事）',
    all: () => { const out = []; for (let m = 1; m <= 10; m++) for (let n = 1; n <= 10; n++) out.push({ m, n }); return out; },
  },

  'edit-distance': {
    why: '两个长 0~6 的串，只用 a、b、c（一个为空、完全相同、互为逆序）',
    small(rng) {
      const alpha = rng.pick(['ab', 'abc']);
      return { word1: str(rng, rng.int(0, 6), alpha), word2: str(rng, rng.int(0, 6), alpha) };
    },
  },

  'longest-common-subsequence': {
    why: '两个长 1~7 的串，只用 a、b、c（没有公共字符、一个是另一个的子序列）',
    small(rng) {
      const alpha = rng.pick(['ab', 'abc', 'abz']);
      return { text1: str(rng, rng.int(1, 7), alpha), text2: str(rng, rng.int(1, 7), rng.chance(0.1) ? 'xy' : alpha) };
    },
  },
};

export const PERF = {
  'climbing-stairs': {
    why: 'n = 45（上限）—— 不带记忆的递归要算几十亿次',
    make() { return { n: 45 }; },
  },
  'house-robber': {
    why: 'n = 100（上限），金额在 [0, 400] 随机 —— 不带记忆的递归是指数级的',
    make(rng) { return { nums: ints(rng, 100, 0, 400) }; },
  },
  'maximum-product-subarray': {
    why: 'n = 2·10^4（上限）：绝大多数是 ±1，夹着一些 0 和几个 ±2~±10（保证乘积装得进 32 位整数）',
    make(rng) {
      const nums = Array.from({ length: 20000 }, () => (rng.chance(0.01) ? 0 : rng.chance(0.5) ? 1 : -1));
      for (const v of [10, -10, 3, -2, 2, 5]) nums[rng.int(0, nums.length - 1)] = v;   // 10·10·3·2·2·5 = 6000
      return { nums };
    },
  },
  'coin-change': {
    why: '12 种面额（上限，2~500 随机），金额 10^4（上限）—— 不带记忆的递归会爆炸',
    make(rng) {
      const coins = new Set();
      while (coins.size < 12) coins.add(rng.int(2, 500));
      return { coins: [...coins], amount: 10000 };
    },
  },
  'partition-equal-subset-sum': {
    why: 'n = 200（上限），全是偶数且总和除以 4 余 2 —— 一半是奇数，必定分不成；朴素的递归要把组合试遍',
    make(rng) {
      const nums = Array.from({ length: 200 }, () => 2 * rng.int(1, 50));
      if (nums.reduce((a, b) => a + b, 0) % 4 === 0) nums[0] = nums[0] === 100 ? 98 : nums[0] + 2;
      return { nums };
    },
  },
  'perfect-squares': {
    why: 'n = 9999（上限附近；8b+7 型，答案是 4，要把整层都搜完）',
    make() { return { n: 9999 }; },
  },
  'word-break': {
    why: 's = 299 个 a 加一个 b，词典是 a、aa、……、10 个 a —— 答案是 false，不带记忆的递归是指数级的',
    make() { return { s: 'a'.repeat(299) + 'b', wordDict: Array.from({ length: 10 }, (_, k) => 'a'.repeat(k + 1)) }; },
  },
  'longest-increasing-subsequence': {
    why: 'n = 2500（上限），元素在 [-10^4, 10^4] 随机',
    make(rng) { return { nums: ints(rng, 2500, -10000, 10000) }; },
  },
  'longest-valid-parentheses': {
    why: '长度 3·10^4（上限）：一段段合法的括号串（长 2~2000）被多余的右括号隔开',
    make(rng) {
      let s = '';
      const valid = (len) => { let out = ''; let open = 0; for (let k = 0; k < len; k++) { const close = open > 0 && (rng.chance(0.5) || open >= len - k); out += close ? ')' : '('; open += close ? -1 : 1; } return out; };
      while (s.length < 30000 - 2002) s += valid(2 * rng.int(1, 1000)) + ')';
      return { s };
    },
  },
  'longest-palindromic-substring': {
    why: '长度 1000（上限），36 种字符随机，中间埋了一段长 41 的回文（唯一的最长回文）',
    make(rng) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const half = str(rng, 20, chars);
      const pal = half + str(rng, 1, chars) + half.split('').reverse().join('');
      const rest = str(rng, 1000 - pal.length, chars);
      const at = rng.int(100, 800);
      return { s: rest.slice(0, at) + pal + rest.slice(at) };
    },
  },
  'unique-paths': {
    why: 'm = n = 17（答案 6 亿，再大就超出 32 位整数）—— 不带记忆的递归要走 6 亿条路',
    make() { return { m: 17, n: 17 }; },
  },
  'edit-distance': {
    why: '两个长 500 的串（上限），小写字母随机',
    make(rng) { return { word1: str(rng, 500, LOWER), word2: str(rng, 500, LOWER) }; },
  },
  'longest-common-subsequence': {
    why: '两个长 1000 的串（上限），小写字母随机',
    make(rng) { return { text1: str(rng, 1000, LOWER), text2: str(rng, 1000, LOWER) }; },
    // 1000×1000 的二维 DP，参考解在浏览器 Python 里就要 0.4 秒（实测），学生的普通写法会被冤枉成「偏慢」
    python: { why: '两个长 700 的串（Python 用小一些的规模：力扣给 Python 的时限本来就宽），小写字母随机', make(rng) { return { text1: str(rng, 700, LOWER), text2: str(rng, 700, LOWER) }; } },
  },
};
