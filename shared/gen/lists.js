/* 链表类题目的随机数据生成器（约定同 arrays.js）
 * 格式和 src/judge.js 的约定一致：
 *   普通链表直接写数组；带环的写 { __list: [...], cycle: i }（没有环就不写 cycle）；
 *   相交链表 B 写 { __list: B 自己那段, __joinTo: 接到 A 的第几个结点 }（不相交就不写 __joinTo）；
 *   随机链表写 { __randomList: [[val, randomIdx 或 null], ...] }。
 *
 * 效率测试：这一批大多不出。力扣给的规模本来就小（两数相加 100、合并两个有序链表 50……），
 * 或者朴素写法也是 O(n)，测不出写法的好坏。
 * 排序链表、合并 K 个升序链表的长链表数据，等到 2026-10 在力扣上实测出递归能到多深、本地对齐之后才出
 * （常见写法是递归合并，递归深度等于链表长度；见 docs/判题机制.md 的「递归深度」）。 */
import { ints } from './util.js';

const sortedInts = (rng, n, lo, hi) => ints(rng, n, lo, hi).sort((a, b) => a - b);

export const GEN = {
  'intersection-of-two-linked-lists': {
    why: 'A 长 1~6、B 自己那段长 1~4，值只在 1~5 里取（值相同的结点很多：按值比的错误写法会被抓住）；约六成相交、相交点随机（含 A 的头和尾）',
    small(rng) {
      const A = ints(rng, rng.int(1, 6), 1, 5);
      const B = ints(rng, rng.int(1, 4), 1, 5);
      if (rng.chance(0.4)) return { headA: { __list: A }, headB: { __list: B } };
      return { headA: { __list: A }, headB: { __list: B, __joinTo: rng.int(0, A.length - 1) } };
    },
  },

  'reverse-linked-list': {
    why: '长度 0~8，值在 [-3, 3]（空链表、单个结点、重复值）',
    small(rng) { return { head: ints(rng, rng.int(0, 8), -3, 3) }; },
  },

  'linked-list-cycle': {
    why: '长度 0~8，值在 [-3, 3]（重复值很多：按值判断「回到原处」的错误写法会被抓住）；约一半有环，环入口随机（含头结点、尾结点自环）',
    small(rng) {
      const vals = ints(rng, rng.int(0, 8), -3, 3);
      if (!vals.length || rng.chance(0.5)) return { head: { __list: vals } };
      return { head: { __list: vals, cycle: rng.int(0, vals.length - 1) } };
    },
  },

  'linked-list-cycle-ii': {
    why: '长度 0~8，值在 [-3, 3]（重复值很多）；约一半有环，环入口随机（含头结点、尾结点自环）',
    small(rng) {
      const vals = ints(rng, rng.int(0, 8), -3, 3);
      if (!vals.length || rng.chance(0.5)) return { head: { __list: vals } };
      return { head: { __list: vals, cycle: rng.int(0, vals.length - 1) } };
    },
  },

  'palindrome-linked-list': {
    why: '长度 1~8，值在 0~2（约一半是回文：奇数 / 偶数长度；另一半随机）',
    small(rng) {
      const n = rng.int(1, 8);
      if (rng.chance(0.5)) return { head: ints(rng, n, 0, 2) };
      const half = ints(rng, Math.floor(n / 2), 0, 2);
      return { head: half.concat(n % 2 ? [rng.int(0, 2)] : [], half.slice().reverse()) };
    },
  },

  'add-two-numbers': {
    why: '两个 1~5 位的数（逆序存放；有进位一路传到最高位、长短不一、其中一个是 0）',
    small(rng) {
      const num = () => {
        if (rng.chance(0.1)) return [0];
        const d = ints(rng, rng.int(1, 5), 0, 9);
        if (d[d.length - 1] === 0) d[d.length - 1] = rng.int(1, 9);   // 最高位（最后一个）不能是 0
        return rng.chance(0.2) ? d.map((x, k) => (k === d.length - 1 ? x : 9)) : d;   // 一串 9：进位一路传上去
      };
      return { l1: num(), l2: num() };
    },
  },

  'merge-two-sorted-lists': {
    why: '两条长 0~5 的有序链表，值在 [-3, 3]（一条为空、两条都空、大量相同的值）',
    small(rng) { return { list1: sortedInts(rng, rng.int(0, 5), -3, 3), list2: sortedInts(rng, rng.int(0, 5), -3, 3) }; },
  },

  'remove-nth-node-from-end-of-list': {
    why: '长度 1~8，n 在 1~长度（删头结点、删尾结点、删完变空链表）',
    small(rng) {
      const len = rng.int(1, 8);
      return { head: ints(rng, len, 0, 9), n: rng.int(1, len) };
    },
  },

  'swap-nodes-in-pairs': {
    why: '长度 0~8，值在 0~9（奇数长度最后一个不动、空链表）',
    small(rng) { return { head: ints(rng, rng.int(0, 8), 0, 9) }; },
  },

  'copy-list-with-random-pointer': {
    why: '长度 0~6，值在 [-3, 3]（值相同的结点很多）；random 随机指向任意结点或为空（含指向自己、多个指向同一个）',
    small(rng) {
      const n = rng.int(0, 6);
      return { head: { __randomList: Array.from({ length: n }, () => [rng.int(-3, 3), rng.chance(0.3) ? null : rng.int(0, n - 1)]) } };
    },
  },

  'reverse-nodes-in-k-group': {
    why: '长度 1~9，k 在 1~长度（k = 1、k = 长度、末尾剩几个不翻）',
    small(rng) {
      const len = rng.int(1, 9);
      return { head: ints(rng, len, 0, 9), k: rng.int(1, len) };
    },
  },

  'merge-k-sorted-lists': {
    why: '0~5 条有序链表，每条长 0~4，值在 [-3, 3]（没有链表、全是空链表、大量相同的值）',
    small(rng) { return { lists: Array.from({ length: rng.int(0, 5) }, () => sortedInts(rng, rng.int(0, 4), -3, 3)) }; },
  },

  'sort-list': {
    why: '长度 0~9，值在 [-3, 3]（已经有序、完全逆序、全部相同）；偶尔用 ±10^5',
    small(rng) {
      const n = rng.int(0, 9);
      return { head: rng.chance(0.1) ? Array.from({ length: n }, () => rng.pick([-100000, 100000, 0])) : ints(rng, n, -3, 3) };
    },
  },
};

export const PERF = {
  'intersection-of-two-linked-lists': {
    why: '两条链表各 3·10^4 个结点（上限）：B 自己那段 10^4 个，接到 A 的第 10^4 个结点上 —— 两两比较的写法是 O(m·n)',
    make(rng) {
      const A = ints(rng, 30000, 1, 100000);
      const B = ints(rng, 10000, 1, 100000);
      return { headA: { __list: A }, headB: { __list: B, __joinTo: 10000 } };
    },
  },
  'sort-list': {
    why: '5·10^4 个结点（上限），值在 [-10^5, 10^5] 随机 —— 插入排序、冒泡排序是 O(n²)；常见的递归归并要递归 5 万层（力扣上没问题）',
    make(rng) { return { head: ints(rng, 50000, -100000, 100000) }; },
  },
  'merge-k-sorted-lists': {
    why: '10^4 条链表（上限），每条 1 个结点，值在 [-10^4, 10^4] 随机 —— 一条一条依次合并、每取一个结点都把 k 个表头扫一遍，都是 O(k·N)',
    make(rng) { return { lists: ints(rng, 10000, -10000, 10000).map((v) => [v]) }; },
  },
};
