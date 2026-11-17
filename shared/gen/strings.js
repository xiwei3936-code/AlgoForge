/* 字符串类题目的随机数据生成器（约定同 arrays.js） */
import { str, LOWER, UPPER } from './util.js';

/** 一个串里是否含有 t 的全部字符（按个数） */
function covers(window, need) {
  const c = {};
  for (const ch of window) c[ch] = (c[ch] || 0) + 1;
  for (const [ch, k] of Object.entries(need)) if ((c[ch] || 0) < k) return false;
  return true;
}
const countOf = (t) => { const m = {}; for (const ch of t) m[ch] = (m[ch] || 0) + 1; return m; };

export const GEN = {
  'longest-substring-without-repeating-characters': {
    why: '长度 0~10，字母表很小（重复频繁），也有大小写、数字、符号、空格混在一起的',
    small(rng) {
      const alpha = rng.pick(['a', 'ab', 'ab', 'abc', 'abc', 'abcd', 'ab ', 'aA', 'aA1 !', 'xy0z', 'pwke']);
      const n = rng.int(0, 10);
      let s = '';
      for (let k = 0; k < n; k++) s += alpha[rng.int(0, alpha.length - 1)];
      return { s };
    },
  },

  'group-anagrams': {
    why: '1~7 个串，长度 0~4、字母表很小（大量互为异位词、完全相同的串、空串）',
    small(rng) {
      const alpha = rng.pick(['ab', 'abc', 'abz', 'a']);
      const n = rng.int(1, 7);
      return { strs: Array.from({ length: n }, () => str(rng, rng.int(0, 4), alpha)) };
    },
  },

  'find-all-anagrams-in-a-string': {
    why: 's 长 1~10、p 长 1~4，字母表很小（重叠的匹配、p 比 s 长）',
    small(rng) {
      const alpha = rng.pick(['ab', 'abc', 'a', 'abz']);
      return { s: str(rng, rng.int(1, 10), alpha), p: str(rng, rng.int(1, 4), alpha) };
    },
  },

  'minimum-window-substring': {
    why: 's 长 1~10、t 长 1~4，大小写混合的小字母表（t 有重复字符、凑不齐时答案为空串）；只保留最短窗口唯一的',
    small(rng) {
      const alpha = rng.pick(['ab', 'aAb', 'abc', 'aAbB']);
      const s = str(rng, rng.int(1, 10), alpha);
      const t = str(rng, rng.int(1, 4), alpha);
      // 力扣保证答案唯一：长度最短的、能覆盖 t 的子串，内容只能有一种
      const need = countOf(t);
      let best = Infinity;
      const found = new Set();
      for (let i = 0; i < s.length; i++) {
        for (let j = i + 1; j <= s.length; j++) {
          if (j - i > best) break;
          if (covers(s.slice(i, j), need)) {
            if (j - i < best) { best = j - i; found.clear(); }
            found.add(s.slice(i, j));
            break;
          }
        }
      }
      if (found.size > 1) return null;
      return { s, t };
    },
  },

  'decode-string': {
    why: '长度不超过 30 的合法编码串：嵌套 0~3 层、重复次数 1~3（偶尔两位数）、括号前后夹着字母',
    small(rng) {
      // 递归造：seq = (字母串 | k[seq])*
      const gen = (depth) => {
        let out = '';
        const parts = rng.int(1, 3);
        for (let i = 0; i < parts; i++) {
          if (depth < 3 && rng.chance(0.5)) out += String(rng.chance(0.1) ? rng.int(10, 12) : rng.int(1, 3)) + '[' + gen(depth + 1) + ']';
          else out += str(rng, rng.int(1, 3), 'abc');
        }
        return out;
      };
      const s = gen(0);
      return s.length <= 30 ? { s } : null;
    },
  },

  'valid-parentheses': {
    why: '长度 1~10：一半是合法的括号串（嵌套、并列），一半随机或在合法串上改坏一个字符',
    small(rng) {
      const pairs = ['()', '[]', '{}'];
      const gen = (len) => {           // 造一个长度为 len（偶数）的合法串
        if (len === 0) return '';
        const inner = 2 * rng.int(0, len / 2 - 1);
        const p = rng.pick(pairs);
        return p[0] + gen(inner) + p[1] + gen(len - 2 - inner);
      };
      let s;
      const mode = rng.int(0, 2);
      if (mode === 0) s = gen(2 * rng.int(1, 5));
      else if (mode === 1) { s = gen(2 * rng.int(1, 5)).split(''); s[rng.int(0, s.length - 1)] = rng.pick('()[]{}'.split('')); s = s.join(''); }
      else s = str(rng, rng.int(1, 10), '()[]{}');
      return { s };
    },
  },

  'partition-labels': {
    why: '长度 1~12，字母表 1~7 个字母（整串只能一段、每个字母一段、交错的字母把段连起来）',
    small(rng) {
      const alpha = 'abcdefg'.slice(0, rng.int(1, 7));
      return { s: str(rng, rng.int(1, 12), alpha) };
    },
  },
};

export const PERF = {
  'longest-substring-without-repeating-characters': {
    why: '长度 5·10^4（上限），字母、数字、符号、空格随机混合',
    make(rng) {
      let s = '';
      for (let k = 0; k < 50000; k++) s += String.fromCharCode(rng.int(32, 126));
      return { s };
    },
  },
  'group-anagrams': {
    why: '10^4 个串（上限），长度 1~100，由 1000 个词各自打乱字母得到（每组约 10 个）',
    make(rng) {
      const words = Array.from({ length: 1000 }, () => str(rng, rng.int(1, 100), LOWER));
      return {
        strs: Array.from({ length: 10000 }, () => rng.shuffle(rng.pick(words).split('')).join('')),
      };
    },
  },
  'find-all-anagrams-in-a-string': {
    why: 's 长 3·10^4（上限），p 长 300，只用 a、b 两个字母（匹配很多）',
    make(rng) { return { s: str(rng, 30000, 'ab'), p: str(rng, 300, 'ab') }; },
  },
  'minimum-window-substring': {
    why: 's 长 10^5（上限），t 是 40 个大写字母；s 里只有一段地方凑得齐 t，别处的大写字母都很稀疏',
    make(rng) {
      const t = str(rng, 40, UPPER);
      // 凑得齐 t 的那一段：t 打乱后，中间夹几个小写字母
      const dense = rng.shuffle(t.split('')).map((ch) => ch + (rng.chance(0.3) ? str(rng, 1, LOWER) : '')).join('');
      const arr = str(rng, 100000 - dense.length, LOWER).split('');
      const at = rng.int(30000, 60000);
      // 别处零星撒一些大写字母（离那一段至少 2000 个字符），凑不成更短的窗口
      for (let k = 0; k < 400; k++) {
        const pos = rng.int(0, arr.length - 1);
        if (Math.abs(pos - at) > 2000) arr[pos] = rng.pick(t.split(''));
      }
      arr.splice(at, 0, ...dense.split(''));
      return { s: arr.join(''), t };
    },
  },
};
