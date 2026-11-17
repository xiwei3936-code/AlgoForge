/* 回溯类题目的随机数据生成器（约定同 arrays.js）
 * 这类题的答案个数随规模指数增长：小数据的规模压得比别的题更小（不然几百组的答案能把题库撑大几 MB）。
 * 都不设效率测试：力扣给的规模本来就很小（全排列 n <= 6、N 皇后 n <= 9……），慢也慢不到超时，
 * 耗时主要花在「输出答案」本身上，测不出写法的好坏。 */
import { str } from './util.js';

/** 组合总和的组合数（力扣保证少于 150 个） */
export function countCombinationSum(cands, target) {
  const ways = new Map();
  const go = (i, left) => {
    if (left === 0) return 1;
    if (i === cands.length || left < 0) return 0;
    const key = i + ',' + left;
    if (!ways.has(key)) ways.set(key, go(i, left - cands[i]) + go(i + 1, left));
    return ways.get(key);
  };
  return go(0, target);
}

export const GEN = {
  'palindrome-partitioning': {
    why: '长度 1~6，字母表很小（整串都是同一个字母时方案最多）',
    small(rng) { return { s: str(rng, rng.int(1, 6), rng.pick(['a', 'ab', 'ab', 'abc'])) }; },
  },

  'permutations': {
    why: '1~4 个互不相同的数，取自 [-10, 10]（含负数和 0）',
    small(rng) { return { nums: rng.shuffle(Array.from({ length: 21 }, (_, k) => k - 10)).slice(0, rng.int(1, 4)) }; },
  },

  'subsets': {
    why: '1~5 个互不相同的数，取自 [-10, 10]（含负数和 0）',
    small(rng) { return { nums: rng.shuffle(Array.from({ length: 21 }, (_, k) => k - 10)).slice(0, rng.int(1, 5)) }; },
  },

  'combination-sum': {
    why: '1~4 个互不相同的候选数（2~9），target 1~16（凑不出、只能用同一个数凑、有多种凑法）',
    small(rng) {
      const cands = rng.shuffle([2, 3, 4, 5, 6, 7, 8, 9]).slice(0, rng.int(1, 4));
      const target = rng.int(1, 16);
      return countCombinationSum(cands, target) < 150 ? { candidates: cands, target } : null;
    },
  },

  'letter-combinations-of-a-phone-number': {
    why: '0~3 个按键（空串、有 7 / 9 这种四个字母的键、同一个键按两次）',
    small(rng) { return { digits: str(rng, rng.int(0, 3), '23456789') }; },
  },

  'n-queens': {
    why: 'n = 1~9 全部列出（2、3 无解）',
    all: () => Array.from({ length: 9 }, (_, k) => ({ n: k + 1 })),
  },

  'generate-parentheses': {
    why: 'n = 1~8 全部列出',
    all: () => Array.from({ length: 8 }, (_, k) => ({ n: k + 1 })),
  },
};

export const PERF = {};
