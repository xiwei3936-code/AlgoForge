/* Java 判题外壳的生成
 * -------------------
 * 关键决定：外壳的 Java 源码放在 server/java/*.java 里，是**真正的 .java 文件**，
 * 不是 JS 模板字符串。原因有两个：
 *   1) 本项目已经两次栽在"模板字符串里的 \\n 变成真换行"上；Java 里到处是 "\\n"、"\\\\"，
 *      写进 JS 模板字符串必炸。放在 .java 文件里就完全没有这一层转义。
 *   2) 保留占位符时它依然是合法 Java，可以直接 javac 做语法检查（scripts/test-javajudge.mjs 会跑）。
 *
 * 替换用 split/join 而不是 String.replace：replace 的替换串里 $& / $1 有特殊含义，
 * base64 里虽然不含 $，但不留这个雷。
 */
import { readFileSync } from 'node:fs';
import { genPerfInput, PERF_LIMITS } from '../shared/caseGen.js';

const JUDGE_SRC = readFileSync(new URL('./java/Hot100Judge.java', import.meta.url), 'utf8');
const LIST_NODE_SRC = readFileSync(new URL('./java/ListNode.java', import.meta.url), 'utf8');
const TREE_NODE_SRC = readFileSync(new URL('./java/TreeNode.java', import.meta.url), 'utf8');
const RAND_NODE_SRC = readFileSync(new URL('./java/Node.java', import.meta.url), 'utf8');

export const JUDGE_CLASS = 'Hot100Judge';
/** Java 字符串字面量上限 65535 字节；用例再大也能装下 */
const CHUNK = 20000;

function chunkBase64(b64) {
  const parts = [];
  for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));
  if (parts.length === 0) parts.push('');
  return parts.map((p) => JSON.stringify(p)).join(', ');
}

function put(src, token, value) {
  return src.split(token).join(value);
}

/* 力扣 Java 会自动导入 java.util.*：HashMap / Arrays / List … 不写 import 也能编译。
 * 本地模板第一行虽然自带 import java.util.*;，但从力扣整段粘过来的代码（没有这一行）
 * 本地会报 cannot find symbol —— 「力扣能过、本地不过」。
 * 所以在第一行**最前面、不换行**地补上：行号和编辑器保持一致；
 * 重复的按需导入是合法的，模板自带的那一行不冲突。
 * 只补力扣确认会导入的 java.util.*，不多补 —— 多补就成了本地比力扣宽松。
 * 写了 package 的不补（import 不能出现在 package 前面）。 */
export const AUTO_IMPORT = 'import java.util.*; ';
export function withAutoImports(code, info) {
  const src = String(code).replace(/^﻿/, '');
  if (info && info.pkg) return src;
  return AUTO_IMPORT + src;
}
/** 编译报错里把补上去的那段去掉：第 1 行的源码回显里删掉它，紧跟着的 ^ 指示行也往回挪同样的宽度 */
export function stripAutoImports(diag) {
  const lines = String(diag).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(AUTO_IMPORT)) continue;
    lines[i] = lines[i].slice(AUTO_IMPORT.length);
    const caret = lines[i + 1];
    if (caret != null && /^\s*\^\s*$/.test(caret) && caret.startsWith(' '.repeat(AUTO_IMPORT.length))) lines[i + 1] = caret.slice(AUTO_IMPORT.length);
  }
  return lines.join('\n');
}

/* ---------------- 按力扣的方式调用一次：签名必须和力扣一致 ----------------
 * 判题外壳靠反射找方法、还会 setAccessible，所以它什么都调得动：
 * private 方法、参数写成 List<Integer>（力扣给的是 int[]）、返回 long（力扣要 int）……
 * 本地照样判「通过」，交到力扣上却是**编译错误** —— 用户的朋友撞上的就是这一类。
 *
 * 做法：照力扣驱动程序的样子，在学生代码旁边多编一个小文件，用力扣官方签名里的类型调一次：
 *     int[] ret = new Solution().twoSum(a0, a1);        // a0 是 int[]，a1 是 int
 * 只编译、不运行。它编不过 = 力扣上会编译失败 = 判不通过（一条用例都不跑，和力扣一样）。
 *
 * 为什么不自己比对类型字符串：哪些写法力扣能接受，规则是 Java 的 —— static 方法、
 * 不写 public（同一个包里能访问）、long 接 int 实参、返回 ArrayList 赋给 List、返回 Integer 赋给 int
 * 全都能编译通过。自己写一套比对，不是漏判就是误杀（误杀就成了「力扣能过、本地不过」）。
 * 交给 javac 判断，标准和力扣天然一致。
 *
 * 签名来自 shared/javaSignatures.js（和力扣官方模板逐题核对过）。
 * 它是从浏览器发来的，要落进 Java 源码 —— 所以这里用一个严格的小语法解析，
 * 只认标识符和 < > [ ] ( ) { } , ; 这几个符号，别的字符一律拒绝。 */
export const LEETCODE_CALL_CLASS = '__LeetCodeCall';

function sigTokens(str) {
  const out = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|[<>[\](){},;])/y;
  let i = 0;
  while (i < str.length) {
    if (/^\s*$/.test(str.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(str);
    if (!m) throw new Error('签名里有不认识的字符：' + str.slice(i, i + 12));
    out.push(m[1]);
    i = re.lastIndex;
  }
  return out;
}

/**
 * 解析 shared/javaSignatures.js 里的一条签名。两种形状：
 *   "public int[] twoSum(int[] nums, int target)"
 *   "class LRUCache { LRUCache(int capacity); int get(int key); void put(int key, int value); }"
 * 返回 { design:false, ret, name, params:[{type,name}] }
 *   或 { design:true, cls, ctor:[{type,name}], methods:[{ret,name,params}] }；格式不对就抛错。
 */
export function parseJavaSignature(str) {
  if (typeof str !== 'string' || !str.trim() || str.length > 600) throw new Error('签名为空或过长');
  const tk = sigTokens(str);
  let p = 0;
  const peek = () => tk[p];
  const eat = (t) => { if (tk[p] !== t) throw new Error(`签名格式不对：第 ${p + 1} 个记号应当是 ${t}，实际是 ${tk[p] ?? '（结尾）'}`); p++; };
  const ident = () => {
    const t = tk[p];
    if (!t || !/^[A-Za-z_]\w*$/.test(t)) throw new Error(`签名格式不对：第 ${p + 1} 个记号应当是名字，实际是 ${t ?? '（结尾）'}`);
    p++;
    return t;
  };
  const type = () => {
    let t = ident();
    if (peek() === '<') {
      p++;
      const args = [type()];
      while (peek() === ',') { p++; args.push(type()); }
      eat('>');
      t += '<' + args.join(', ') + '>';
    }
    while (peek() === '[') { p++; eat(']'); t += '[]'; }
    return t;
  };
  const params = () => {
    eat('(');
    const ps = [];
    if (peek() !== ')') {
      for (;;) {
        const ty = type();
        ps.push({ type: ty, name: ident() });
        if (peek() !== ',') break;
        p++;
      }
    }
    eat(')');
    return ps;
  };

  if (peek() === 'class') {
    p++;
    const cls = ident();
    eat('{');
    let ctor = null;
    const methods = [];
    while (peek() !== '}') {
      if (peek() === 'public') p++;
      if (peek() === cls && tk[p + 1] === '(') {
        p++;
        ctor = params();
      } else {
        const ret = type();
        const name = ident();
        methods.push({ ret, name, params: params() });
      }
      eat(';');
    }
    eat('}');
    if (p !== tk.length) throw new Error('签名结尾多出了内容');
    return { design: true, cls, ctor: ctor || [], methods };
  }
  if (peek() === 'public') p++;
  const ret = type();
  const name = ident();
  const ps = params();
  if (p !== tk.length) throw new Error('签名结尾多出了内容');
  return { design: false, ret, name, params: ps };
}

const showParams = (ps) => ps.map((x) => `${x.type} ${x.name}`).join(', ');
const argNames = (ps) => ps.map((x) => x.name).join(', ');

/**
 * 生成「按力扣的方式调用一次」的那个文件。每个调用独占一行，记下行号 ——
 * javac 报错时按行号就知道是哪个方法（或构造函数）对不上。
 * 返回 { name, content, calls:[{ line, member, want, how }] }
 *   member —— 方法名；构造函数是类名
 *   want   —— 力扣要求的写法（给人看的）
 *   how    —— 力扣是怎么调用它的（用官方形参名写，给人看的）
 */
export function buildLeetCodeCall(sig) {
  const L = [
    'import java.util.*;',
    '',
    '/* 判题程序自动生成：照力扣驱动程序的样子调用一次你的代码。只编译、不运行。',
    '   这个文件编不过，就说明你的代码交到力扣上会编译失败。 */',
    `class ${LEETCODE_CALL_CLASS} {`,
  ];
  const calls = [];
  const line = (text, call) => { L.push(text); if (call) calls.push({ line: L.length, ...call }); };
  if (!sig.design) {
    const ps = sig.params.map((x, i) => `${x.type} a${i}`).join(', ');
    L.push(`    static void call(${ps}) {`);
    const expr = `new Solution().${sig.name}(${sig.params.map((_, i) => `a${i}`).join(', ')})`;
    const shown = `new Solution().${sig.name}(${argNames(sig.params)})`;
    line(sig.ret === 'void' ? `        ${expr};` : `        ${sig.ret} ret = ${expr};`, {
      member: sig.name,
      want: `public ${sig.ret} ${sig.name}(${showParams(sig.params)})`,
      how: sig.ret === 'void' ? `${shown};` : `${sig.ret} ret = ${shown};`,
    });
  } else {
    const all = [];
    const vars = (ps, tag) => ps.map((x, i) => { all.push(`${x.type} ${tag}_${i}`); return `${tag}_${i}`; }).join(', ');
    const ctorArgs = vars(sig.ctor, 'c');
    const body = [];
    body.push([`        ${sig.cls} obj = new ${sig.cls}(${ctorArgs});`, {
      member: sig.cls,
      want: `public ${sig.cls}(${showParams(sig.ctor)})`,
      how: `${sig.cls} obj = new ${sig.cls}(${argNames(sig.ctor)});`,
    }]);
    sig.methods.forEach((m, k) => {
      const expr = `obj.${m.name}(${vars(m.params, 'm' + k)})`;
      const shown = `obj.${m.name}(${argNames(m.params)})`;
      body.push([m.ret === 'void' ? `        ${expr};` : `        ${m.ret} r${k} = ${expr};`, {
        member: m.name,
        want: `public ${m.ret} ${m.name}(${showParams(m.params)})`,
        how: m.ret === 'void' ? `${shown};` : `${m.ret} r${k} = ${shown};`,
      }]);
    });
    L.push(`    static void call(${all.join(', ')}) {`);
    for (const [text, call] of body) line(text, call);
  }
  L.push('    }');
  L.push('}');
  return { name: `${LEETCODE_CALL_CLASS}.java`, content: L.join('\n') + '\n', calls };
}

/* javac 的诊断按「块」切：每块以 `文件名.java:行号: 错误: …` 开头，后面跟源码回显、^、符号/位置等细节行。
   中英两种 locale 都认（诊断语言跟随系统）。 */
const DIAG_HEAD = /^([\w$]+\.java):(\d+): (错误|警告|error|warning): ?(.*)$/;
const DIAG_COUNT = /^(\d+)( 个错误| errors?)$/;

/**
 * 把 javac 的输出拆成两份：学生代码自己的问题，和「按力扣方式调用」那个文件的问题。
 *   ★ 学生代码自己有编译错误时，只给他看他自己的（调用文件的报错多半是连带的，只会添乱）。
 *   ★ 学生代码没错、只有调用文件编不过 —— 那就是签名和力扣对不上。
 * 返回 { rest, userErrors, failures:[{ call, reason:[行…] }], callErrors }
 */
export function splitLeetCodeCallDiag(diag, lc) {
  const lines = String(diag).split('\n');
  const blocks = [];
  let cur = { head: null, lines: [] };
  const tail = [];
  for (const l of lines) {
    const h = DIAG_HEAD.exec(l);
    if (h) {
      blocks.push(cur);
      cur = { head: { file: h[1], line: Number(h[2]), kind: h[3], msg: h[4] }, lines: [l] };
    } else if (DIAG_COUNT.test(l.trim())) {
      tail.push(l);
    } else {
      cur.lines.push(l);
    }
  }
  blocks.push(cur);
  const isErr = (b) => b.head && (b.head.kind === '错误' || b.head.kind === 'error');
  const mine = (b) => b.head && b.head.file === lc.name;
  const userErrors = blocks.filter((b) => isErr(b) && !mine(b)).length;
  const callBlocks = blocks.filter((b) => isErr(b) && mine(b));

  const failures = [];
  for (const b of callBlocks) {
    const call = lc.calls.find((c) => c.line === b.head.line) || null;
    // 细节行（符号: / 位置: / 需要: / 找到: / 原因:）是两个空格缩进；源码回显和 ^ 不要 —— 那是生成的代码，学生看不懂
    const tidy = (l) => l.trim().replace(/\s+/g, ' ').replace(/[;；]$/, '');   // 后面用「；」连起来，原句尾的分号去掉免得叠成「;；」
    const reason = [b.head.msg, ...b.lines.slice(1).filter((l) => /^ {2}\S/.test(l))].map(tidy).filter(Boolean);
    const same = failures.find((f) => f.call === call);
    if (same) same.reason.push(...reason);
    else failures.push({ call, reason });
  }

  // 学生自己的那份：去掉调用文件的块；末尾「N 个错误」按剩下的重新数
  const kept = blocks.filter((b) => !mine(b)).flatMap((b) => b.lines);
  const fixedTail = tail.map((l) => {
    const m = DIAG_COUNT.exec(l.trim());
    if (!m || !callBlocks.length) return l;
    if (/个错误/.test(m[2])) return `${userErrors} 个错误`;
    return `${userErrors} error${userErrors === 1 ? '' : 's'}`;
  });
  const rest = [...kept, ...fixedTail].join('\n');
  return { rest, userErrors, failures, callErrors: callBlocks.length };
}

/** 在学生代码里找某个方法（或构造函数）的声明行，给「你写的是」用。找不到就返回空数组。 */
export function findDeclarations(code, member, isCtor) {
  const out = [];
  const name = member.replace(/[^\w$]/g, '');
  const re = isCtor
    ? new RegExp(`^\\s*(?:(?:public|private|protected)\\s+)?${name}\\s*\\(`)
    : new RegExp(`^\\s*(?:@\\w+\\s+)*(?:(?:public|private|protected|static|final|synchronized)\\s+)*[\\w$<>\\[\\],.? ]*?[\\w$>\\]]\\s+${name}\\s*\\(`);
  String(code).split(/\r?\n/).forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/^(return|new|throw|else|case)\b/.test(t)) return;
    if (re.test(l)) out.push({ line: i + 1, text: t.replace(/\s*\{.*$/, '').replace(/\s*;\s*$/, '') });
  });
  return out;
}

/** 拼出给学生看的说明。lc 是 buildLeetCodeCall 的结果，sig 是 parseJavaSignature 的结果。 */
export function explainLeetCodeCall(failures, lc, sig, code) {
  const who = sig.design ? sig.cls : 'Solution';
  const known = failures.filter((f) => f.call);
  let what = who;
  if (known.length > 1) what = `${who} 有 ${known.length} 处`;
  else if (known.length === 1) {
    // 非设计类那一行同时在 new Solution()：报的是构造器的话，问题出在 Solution 本身，不在方法上
    const ctorOfSolution = !sig.design && /构造器|constructor/i.test(known[0].reason.join(' '));
    what = known[0].call.member === who ? `${who} 的构造函数` : ctorOfSolution ? 'Solution' : known[0].call.member;
  }
  const out = [
    `你的 ${what}${/[一-龥]$/.test(what) ? '' : ' '}和力扣要求的写法对不上。`,
    '这段代码交到力扣上会「编译出错」，所以这里也直接判为不通过（一条用例都没有跑）。',
  ];

  failures.forEach((f, k) => {
    out.push('');
    const javac = f.reason.filter(Boolean).join('；');
    if (!f.call) {                               // 理论上不会走到：报错不在任何一个调用行上
      out.push('javac 的原话：' + javac);
      return;
    }
    const isCtor = sig.design && f.call.member === sig.cls;
    // 非设计类的那一行同时在 new Solution()：报的是构造器，说明 Solution 没有能用的无参构造
    const solutionCtor = !sig.design && /构造器|constructor/i.test(javac);
    const label = known.length > 1 ? `${'①②③④⑤⑥⑦⑧⑨'[k] || '·'} ` : '';
    if (solutionCtor) {
      out.push(`${label}力扣会先执行 new Solution()，所以 Solution 要有一个无参的构造函数。`);
      out.push('   最简单的办法是不写构造函数（Java 会自动补一个无参的）；要写的话，再补一个 public Solution() {}。');
    } else {
      out.push(`${label}力扣要求：${f.call.want}`);
      const decl = findDeclarations(code, f.call.member, isCtor);
      if (decl.length) {
        for (const d of decl.slice(0, 3)) out.push(`${label ? '   ' : ''}你写的是：${d.text}（第 ${d.line} 行）`);
      } else {
        out.push(`${label ? '   ' : ''}你写的是：（没找到叫 ${f.call.member} 的${isCtor ? '构造函数' : '方法'} —— Java 区分大小写）`);
      }
    }
    out.push(`${label ? '   ' : ''}javac 的原话：${javac}`);
  });

  out.push('');
  out.push(`力扣是在另一个类里这样调用你的代码的：`);
  if (!sig.design) out.push('    ' + lc.calls[0].how);
  else for (const c of lc.calls) out.push('    ' + c.how);
  out.push('所以方法不能是 private；参数类型要和力扣的一模一样（比如 int[] 不能换成 List<Integer>）；返回值要能直接赋给力扣那边的类型。');
  return out.join('\n');
}

/**
 * 组装判题需要的全部源文件。
 * code  —— 学生写的代码，原样写进单独的文件（javac 报错行号因此与编辑器一致）
 * info  —— server/java-runner.mjs 的 analyzeSource(code) 结果
 * spec  —— shared/judgeSpec.js 的 javaJudgeSpec(problem, marker)（methodName / compareMode / cases / signature …）
 * 返回 { files: [{name, content}], mainClass, leetcode } 或 { error }
 *   leetcode —— 有签名时是 { name, calls, sig }，编译失败时用它把「签名对不上」单独拎出来；没签名是 null
 */
export function buildJudgeFiles(code, info, spec) {
  const types = info.topLevelTypes || [];

  if (info.pkg) {
    return { error: '判题模式下请不要写 package 声明（判题外壳与你的代码需要在同一个默认包里）。' };
  }
  /* 设计类（LRU 缓存 / 最小栈 / Trie / 数据流的中位数）要的类名是题目指定的那个
     （LRUCache / MinStack / …），不是 Solution —— 和 LeetCode 一样。
     所以这道检查对它们要按 spec.methodName 里那个类名来查。 */
  const wantClass = spec.design ? (spec.methodName || '') : 'Solution';
  if (wantClass && !types.includes(wantClass)) {
    return {
      error: types.length
        ? `判题模式要求最外层有一个 class ${wantClass}，但你写的是：${types.join('、')}。\n请把类名改成 ${wantClass}（和 LeetCode 一样）。`
        : `没找到任何 class。判题模式要求你写一个最外层的 class ${wantClass}，并在里面实现题目要求的方法。`,
    };
  }
  if (types.includes(JUDGE_CLASS)) {
    return { error: `类名 ${JUDGE_CLASS} 被判题程序占用了，请换一个名字。` };
  }
  if (types.includes(LEETCODE_CALL_CLASS)) {
    return { error: `类名 ${LEETCODE_CALL_CLASS} 被判题程序占用了，请换一个名字。` };
  }

  let leetcode = null;
  if (spec.signature != null) {
    let sig;
    try { sig = parseJavaSignature(spec.signature); }
    catch (e) { return { error: '判题数据里的力扣签名格式不对（这是程序的问题，不是你的代码）：' + e.message }; }
    const lc = buildLeetCodeCall(sig);
    leetcode = { name: lc.name, content: lc.content, calls: lc.calls, sig };
  }

  // public 类必须与文件名同名，否则 javac 直接报错。学生的类通常是 public class Solution。
  const userFile = `${info.publicType || wantClass || 'Solution'}.java`;

  /* 效率测试：按题号现场生成大数据，追加成**最后一条**用例（Hot100Judge 认 __PERF__：前面全过才跑它）。
     和浏览器那边给 Python 生成的是同一个函数、同一个种子，所以两种语言测的是同一份数据。 */
  let allCases = spec.cases || [];
  if (spec.perf) {
    const input = genPerfInput(spec.perf.id);
    if (!input) return { error: '这道题没有效率测试的数据生成器（这是程序的问题，不是你的代码）：' + spec.perf.id };
    const digest = typeof spec.perf.digest === 'string';
    const expected = digest ? spec.perf.digest : spec.perf.expected;
    const pc = spec.design ? { ops: input.ops, callArgs: input.args, expected } : { args: Object.values(input), expected };
    if (digest) pc.digest = true;
    allCases = [...allCases, pc];
  }
  const cases = JSON.stringify(allCases);
  const b64 = Buffer.from(cases, 'utf8').toString('base64');

  let judge = JUDGE_SRC;
  judge = put(judge, '"__MARK__"', JSON.stringify(spec.marker));
  judge = put(judge, '"__METHOD__"', JSON.stringify(spec.methodName));
  judge = put(judge, '"__MODE__"', JSON.stringify(spec.compareMode || 'exact'));
  judge = put(judge, '"__INPLACE__"', JSON.stringify(spec.inPlace ? 'true' : 'false'));
  judge = put(judge, '"__DESIGN__"', JSON.stringify(spec.design ? 'true' : 'false'));
  judge = put(judge, '"__OUT_NODE_IDX__"', JSON.stringify(spec.nodeIndexOut ? 'true' : 'false'));
  judge = put(judge, '"__OUT_NODE_VAL__"', JSON.stringify(spec.nodeValueOut ? 'true' : 'false'));
  judge = put(judge, '"__OUT_RAND__"', JSON.stringify(spec.randomListOut ? 'true' : 'false'));
  // 设计类里力扣签名返回 void 的方法：返回值一律记 null（继承来的 LinkedHashMap.put 会返回旧值），见 Hot100Judge.VOID_METHODS
  const voidMethods = leetcode && leetcode.sig.design ? leetcode.sig.methods.filter((m) => m.ret === 'void').map((m) => m.name) : [];
  judge = put(judge, '"__VOID__"', JSON.stringify(voidMethods.join(',')));
  judge = put(judge, '"__PERF__"', JSON.stringify(spec.perf ? 'true' : 'false'));
  judge = put(judge, '"__PERF_CAP__"', JSON.stringify(String(PERF_LIMITS.java.fail)));
  judge = put(judge, '"__CASES__"', chunkBase64(b64));

  const files = [
    { name: userFile, content: withAutoImports(code, info) },
    { name: `${JUDGE_CLASS}.java`, content: judge },
  ];
  // 结点类只在学生自己没定义时补上 —— 他们从 LeetCode 注释里粘一份出来也不会撞成"重复的类"
  if (!types.includes('ListNode')) files.push({ name: 'ListNode.java', content: LIST_NODE_SRC });
  if (!types.includes('TreeNode')) files.push({ name: 'TreeNode.java', content: TREE_NODE_SRC });
  // 随机链表的 Node 只在真用得上的题里补，免得给别的题平白多一个类
  if (spec.randomList && !types.includes('Node')) files.push({ name: 'Node.java', content: RAND_NODE_SRC });
  // 和学生代码一起编：不另起一次 javac（每次多等 1 秒），报错再按文件拆开，见 splitLeetCodeCallDiag
  if (leetcode) files.push({ name: leetcode.name, content: leetcode.content });

  return { files, mainClass: JUDGE_CLASS, leetcode };
}

/* 这些断言与 casesFromProblem 的**唯一定义**在 shared/judgeSpec.js。
 * 这里只是再导出，好让老的 import 路径继续能用 ——
 * 当初正是因为界面自己手搓了一份 spec，8 道题的 Java 判题在程序里全坏了。
 * ⚠ 它原来在 src/ 下，可安装包里没有 src\ —— 打包版服务端一启动就 Module not found（2.3.0 打包时端到端自检拦下）。
 *   所以挪到 shared/（会进包），test-package 另有一道闸门：server/ 与 vite.config.js 引用的文件都必须在会进包的目录里。 */
export {
  isDesign, isNodeIndexOut, isNodeValueOut, isRandomList, isRandomListOut, isInPlace,
  casesFromProblem, javaJudgeSpec,
} from '../shared/judgeSpec.js';
