/* 设计类题目的随机数据生成器（约定同 arrays.js）：一条用例是一串调用 { ops, args }，ops[0] 是类名 */
import { str } from './util.js';

export const GEN = {
  'lru-cache': {
    why: '容量 1~3、键 0~4（反复命中同一个键、覆盖写、刚好挤满再挤出）的 1~15 次随机调用',
    small(rng) {
      const cap = rng.int(1, 3);
      const m = rng.int(1, 15);
      const ops = ['LRUCache'];
      const args = [[cap]];
      for (let k = 0; k < m; k++) {
        if (rng.chance(0.5)) { ops.push('put'); args.push([rng.int(0, 4), rng.int(0, 9)]); }
        else { ops.push('get'); args.push([rng.int(0, 4)]); }
      }
      return { ops, args };
    },
  },

  'implement-trie-prefix-tree': {
    why: '1~15 次随机调用，单词只用 a、b、长 1~3（插入后查前缀 / 查完整单词、查没插入过的、同一个词插两次）',
    small(rng) {
      const ops = ['Trie'], args = [[]];
      const m = rng.int(1, 15);
      for (let k = 0; k < m; k++) {
        ops.push(rng.pick(['insert', 'insert', 'search', 'startsWith']));
        args.push([str(rng, rng.int(1, 3), 'ab')]);
      }
      return { ops, args };
    },
  },

  'min-stack': {
    why: '1~15 次随机调用，值在 [-3, 3]（最小值重复出现、弹出最小值后恢复成次小值）；偶尔混入 int 极值；pop / top / getMin 只在栈非空时调',
    small(rng) {
      const ops = ['MinStack'], args = [[]];
      let size = 0;
      const m = rng.int(1, 15);
      for (let k = 0; k < m; k++) {
        if (size === 0 || rng.chance(0.45)) {
          ops.push('push');
          args.push([rng.chance(0.1) ? rng.pick([-2147483648, 2147483647]) : rng.int(-3, 3)]);
          size++;
        } else {
          const op = rng.pick(['pop', 'top', 'getMin']);
          ops.push(op);
          args.push([]);
          if (op === 'pop') size--;
        }
      }
      return { ops, args };
    },
  },

  'find-median-from-data-stream': {
    why: '1~14 次随机调用，数在 [-3, 3]（个数奇 / 偶、大量重复、负数）；findMedian 只在加过数之后调',
    small(rng) {
      const ops = ['MedianFinder', 'addNum'], args = [[], [rng.int(-3, 3)]];
      const m = rng.int(0, 13);
      for (let k = 0; k < m; k++) {
        if (rng.chance(0.55)) { ops.push('addNum'); args.push([rng.chance(0.1) ? rng.pick([-100000, 100000]) : rng.int(-3, 3)]); }
        else { ops.push('findMedian'); args.push([]); }
      }
      return { ops, args };
    },
  },
};

export const PERF = {
  'lru-cache': {
    why: '容量 3000、2·10^5 次 get / put（上限），键在 [0, 10^4]',
    make(rng) {
      const ops = ['LRUCache'];
      const args = [[3000]];
      for (let k = 0; k < 200000; k++) {
        if (rng.chance(0.5)) { ops.push('put'); args.push([rng.int(0, 10000), rng.int(0, 100000)]); }
        else { ops.push('get'); args.push([rng.int(0, 10000)]); }
      }
      return { ops, args };
    },
  },
  'implement-trie-prefix-tree': {
    why: '3·10^4 次调用（上限）：先插入 10^4 个互不相同、长 20 的单词（只用 a、b、c：前缀大量重合），再查 2·10^4 次（大多查不到）—— 把单词存起来逐个比的写法每次都要比完所有单词',
    make(rng) {
      const words = new Set();
      while (words.size < 10000) words.add(str(rng, 20, 'abc'));
      const ops = ['Trie'], args = [[]];
      for (const w of words) { ops.push('insert'); args.push([w]); }
      for (let k = 0; k < 20000; k++) {
        // 查完整单词：随机串几乎都不在里面；查前缀：长 12 的随机前缀，大多也不在
        if (k % 2) { ops.push('search'); args.push([str(rng, 20, 'abc')]); }
        else { ops.push('startsWith'); args.push([str(rng, 12, 'abc')]); }
      }
      return { ops, args };
    },
  },
  'min-stack': {
    why: '3·10^4 次调用（上限）：先压入 15000 个递增的数，再交替调 getMin / top —— 每次 getMin 都扫一遍栈的写法是 O(n²)',
    make(rng) {
      const ops = ['MinStack'], args = [[]];
      for (let k = 0; k < 15000; k++) { ops.push('push'); args.push([k * 2 + rng.int(0, 1)]); }
      for (let k = 0; k < 15000; k++) { ops.push(k % 2 ? 'top' : 'getMin'); args.push([]); }
      return { ops, args };
    },
  },
  'find-median-from-data-stream': {
    why: '5·10^4 次调用（上限）：加数和求中位数交替，数在 [-10^5, 10^5] 随机 —— 每次求中位数都重新排序的写法是 O(n² log n)',
    make(rng) {
      const ops = ['MedianFinder'], args = [[]];
      for (let k = 0; k < 25000; k++) {
        ops.push('addNum'); args.push([rng.int(-100000, 100000)]);
        ops.push('findMedian'); args.push([]);
      }
      return { ops, args };
    },
  },
};
