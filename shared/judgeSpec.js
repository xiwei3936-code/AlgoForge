/* Java 判题的 spec —— **只有这一份**。
 * ==================================================================
 * 为什么要单独抽出来：这里曾经有两套口径，而且只有用户走的那一套是坏的。
 *
 *   验证脚本（scripts/verify-java.mjs）  ：拿整个 problem，自己算全部标志 -> 一直是对的
 *   程序界面（src/App.jsx）              ：手工挑了 5 个字段发给服务端 -> 漏了 4 个标志
 *
 * 漏掉的是 design / nodeIndexOut / nodeValueOut / randomList(Out)。
 * 后果：8 道题（相交链表、环形链表 II、LRU 缓存、随机链表的复制、
 * 二叉树的最近公共祖先、Trie、最小栈、数据流的中位数）在**程序里**永远判不过 ——
 * 而 verify-java.mjs 报 100/100 全过，因为它走的根本不是同一条路。
 *
 * 用户那边看到的是「我的代码在力扣能过，在这儿过不了」，
 * 而且连参考解都过不了 —— 实测参考解也是 0/6。
 *
 * ⚠ 所以：**新增任何判题标志，只能加在 javaJudgeSpec 里。**
 *   scripts/test-judgespec.mjs 会检查「判题外壳读到的每一个 spec 字段，
 *   这里都必须设」—— 漏一个当场报错，不会再等用户来报。
 *
 * 这个文件必须保持**纯净**：不碰 DOM、不碰 node 内置模块 ——
 * 浏览器（App.jsx）和 Node（server/、scripts/）两边都要 import 它。
 */
import { JAVA_SIGNATURES } from './javaSignatures.js';

/** ioType 是逗号分隔的标签串，这里统一按标签取 */
function tags(problem) {
  return String((problem && problem.ioType) || '').split(',').map((s) => s.trim());
}

/** 设计类：没有单一入口，用例由 ops/args 调用序列驱动（LRU 缓存 / 最小栈 / Trie / 中位数） */
export function isDesign(problem) { return tags(problem).includes('design'); }

/** 返回的是链表结点，但要按「它在 headA 里的下标」比对（相交链表、环形链表 II） */
export function isNodeIndexOut(problem) { return tags(problem).includes('node-index-output'); }

/** 返回的是树结点，但要按结点的值比对（最近公共祖先） */
export function isNodeValueOut(problem) { return tags(problem).includes('node-value-output'); }

/** 带 random 指针的链表（随机链表的复制），输入侧要多补一个 Node 类 */
export function isRandomList(problem) {
  const t = tags(problem);
  return t.includes('random-list-input') || t.includes('random-list-output');
}

/** 输出也是带 random 指针的链表，比对方式特殊 */
export function isRandomListOut(problem) { return tags(problem).includes('random-list-output'); }

/** 原地修改：答案看的是入参被改成什么样，不是返回值 */
export function isInPlace(problem) { return tags(problem).includes('in-place'); }

/** 题库里的 testCase（input 是有序对象）转成判题外壳要的形式。
 *
 *  ⚠ 设计类不能走 Object.values(tc.input)：它的 input 是 { ops, args }，
 *    那样 ops 和 args 会靠 JSON 的键序混进一个数组，键序一变就静默传反、且不报错。
 *    所以显式拆成 ops / callArgs 两个字段。 */
export function casesFromProblem(problem) {
  if (isDesign(problem)) {
    return (problem.testCases || []).map((tc) => ({
      ops: (tc.input && tc.input.ops) || [],
      callArgs: (tc.input && tc.input.args) || [],
      expected: tc.expected,
    }));
  }
  return (problem.testCases || []).map((tc) => ({
    // 按【位置】传参：Java 的形参名可以和 Python 不一样，只有顺序是可靠的
    args: Object.values(tc.input),
    expected: tc.expected,
  }));
}

/** 判题外壳要的完整 spec。**界面、验证脚本、对抗测试都必须用这一个函数。**
 *  自己手搓一个对象，就是当初那 8 道题坏掉的原因。 */
export function javaJudgeSpec(problem, marker) {
  return {
    methodName: problem.methodName,
    compareMode: problem.compareMode || 'exact',
    inPlace: isInPlace(problem),
    design: isDesign(problem),
    nodeIndexOut: isNodeIndexOut(problem),
    nodeValueOut: isNodeValueOut(problem),
    randomList: isRandomList(problem),
    randomListOut: isRandomListOut(problem),
    cases: casesFromProblem(problem),
    /* 力扣官方签名：服务端照它生成一个「按力扣的方式调用一次」的文件和学生代码一起编，
       编不过 = 力扣上会编译失败 = 判不通过（server/java-harness.mjs 的 buildLeetCodeCall）。
       找不到时给 null 而不是 undefined：undefined 过一遍 JSON 就没了，服务端分不清「没有」和「漏传」。 */
    signature: JAVA_SIGNATURES[problem.id] || null,
    /* 效率测试：只传题号和答案（或摘要），大数据由服务端用 shared/caseGen.js 现场生成 ——
       一组就有几百 KB，随请求发过去会撞上 200KB 的上限。 */
    perf: problem.perf
      ? (typeof problem.perf.digest === 'string' ? { id: problem.id, digest: problem.perf.digest } : { id: problem.id, expected: problem.perf.expected })
      : null,
    marker,
  };
}
