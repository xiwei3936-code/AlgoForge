/* 本地 Java 执行器（Vite 中间件，dev 与 preview 都挂）
 * ---------------------------------------------------
 * 实测得出的几条硬约束（改之前先读）：
 * * 用**多文件 javac** 而不是 `java Xxx.java` 单文件源码模式：JDK 21 只支持单文件源码启动
 *   （多文件是 JDK 22 的 JEP 458），单文件会迫使前置代码和用户代码拼进同一个文件，
 *   javac 报错行号就和编辑器永久错位。多文件下用户代码独占一个文件，行号精确对应。
 * * 运行必须显式指定 stdout 编码，否则中文输出按 GBK 写出、读成 UTF-8 就是乱码。
 *   `-Dfile.encoding=UTF-8` 不管用：JDK 19 起 System.out 的编码由 stdout.encoding 单独决定，
 *   不再跟 file.encoding 走（实测 file.encoding=UTF-8 而 out.charset=GBK）。
 *   属性名换过：JDK 19+ 叫 stdout.encoding，18 及更早叫 sun.stdout.encoding。
 *   **两套都传** —— 实测 JDK 21 两个名字都认，传它不认识的属性也只会被忽略，
 *   于是一次覆盖 JDK 11~21+，不必按版本分支。
 * * javac 自己的诊断是本地化中文且按 GBK 写出 —— 只对它做编码猜测，java 侧已强制 UTF-8 不要猜。
 *
 * 安全边界：拒绝跨站请求（Origin / Sec-Fetch-Site / Content-Type 三道）、只接受 code 字符串
 * （绝不接受客户端给的路径）、请求体与输出都有上限、整体时间预算、超时强杀整棵进程树。
 */
import { spawn, execFile } from 'node:child_process';
import { buildJudgeFiles, withAutoImports, stripAutoImports, splitLeetCodeCallDiag, explainLeetCodeCall } from './java-harness.mjs';
import { PERF } from '../shared/caseGen.js';
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/* 编译 / 运行的临时目录：**每个进程一个**（目录名带进程号）。
 * 原来写死成 %TEMP%\hot100-java，所有进程共用 —— 而 handleRun 每次都先把整个目录删掉重建。
 * 进程内部有 busy 标记防重入，可它管不到别的进程：用户开着程序时跑 npm test、或者几个脚本同时跑代码，
 * 就会互相删掉对方刚写进去的 .java / .class，表现为「莫名其妙编译失败」，而且几乎复现不了。
 * 进程退出时把自己那份清掉，不在临时目录里越攒越多。HOT100_JAVA_WORK 可以手动指定（排查时用）。 */
const WORK_DIR = process.env.HOT100_JAVA_WORK || join(tmpdir(), `hot100-java-${process.pid}`);
process.once('exit', () => { try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* 退出时清不掉就算了 */ } });
const SRC_DIR = join(WORK_DIR, 'src');
const OUT_DIR = join(WORK_DIR, 'out');
export const MAX_CODE_BYTES = 200 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;     // 输出洪水保护：超过就截断并强杀
const TOTAL_BUDGET_MS = 8000;             // 自由运行：编译 + 运行的**总**预算，不是每段各 8 秒
const JUDGE_BUDGET_MS = 12000;            // 判题：要多编译 3 个外壳文件，再逐个用例跑一遍
const BODY_TIMEOUT_MS = 5000;
const KILL_GRACE_MS = 1500;

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5178', 'http://127.0.0.1:5178',
  'http://localhost:5173', 'http://127.0.0.1:5173',
]);

let busy = false;
let jdkCache = null;
let jdkProbe = null;

/* 版本下限。用 `javac --release N` 实测出来的，不是拍脑袋：
   判题外壳（server/java/*.java）能编到 8，75 道参考解与 75 个 starter 能编到 11。
   所以真正的硬下限是 11 —— 以前文档里写的"需要 JDK 21"只是当初开发机上装的版本。
   17 是当前主流 LTS，低于它不拦，只提示。 */
export const MIN_JDK = 11;
export const RECOMMENDED_JDK = 17;

/**
 * 用哪一个 JDK。
 * 打包版把 jlink 裁剪过的运行时放在包内（runtime\jdk），由启动器通过环境变量
 * HOT100_JAVA_HOME 指过来；源码开发时不设这个变量，就还是用 PATH 里的 javac / java。
 * 服务端因此完全不需要知道自己是「包内跑」还是「源码跑」。
 *
 * 指了却找不到时**明确报错，绝不偷偷回落到 PATH** ——
 * 否则「包内运行时缺文件」会伪装成「版本莫名其妙不对」，把排查方向带偏。
 */
export function resolveJavaHome(env = process.env) {
  const home = env.HOT100_JAVA_HOME;
  if (!home) return { bundled: false, ok: true, home: null, javac: 'javac', java: 'java' };
  const ext = process.platform === 'win32' ? '.exe' : '';
  const javac = join(home, 'bin', 'javac' + ext);
  const java = join(home, 'bin', 'java' + ext);
  return { bundled: true, ok: existsSync(javac) && existsSync(java), home, javac, java };
}

/**
 * 把一次 `javac -version` 的结果判成环境状态。
 * 单独抽成纯函数是为了能直接测本机装不了的版本 —— 开发机上只有一个 JDK，
 * 「JDK 8 会不会被拦住」这种事不该靠推理。
 */
export function classifyJdk(err, msg) {
  const text = String(msg || '');
  const found = ((!err && text) || text.startsWith('javac')) ? true : false;
  if (!found) {
    return { available: false, version: null, major: null, error: '未检测到 javac。请安装 JDK 并确保 javac 在 PATH 中。' };
  }
  const major = parseJavacMajor(text);
  if (major !== null && major < MIN_JDK) {
    // 版本太低必须**当场说清楚**。以前这里根本不看版本号，
    // 于是低版本用户看到的是"JDK 可用"，然后撞上一堆莫名其妙的编译错误。
    return {
      available: false, version: text, major,
      error: `检测到 JDK ${major}，本工具最低需要 JDK ${MIN_JDK}（推荐 ${RECOMMENDED_JDK} 或更高）。升级后刷新页面即可。`,
    };
  }
  return {
    available: true, version: text, major,
    // 版本号读不出来时既不拦也不提示：读不出来不等于有问题
    belowRecommended: major !== null && major < RECOMMENDED_JDK,
    recommended: RECOMMENDED_JDK,
  };
}

/** 从 `javac -version` 的输出里取主版本号。JDK 8 及更早写成 "javac 1.8.0_202"。 */
export function parseJavacMajor(text) {
  const m = /javac\s+(\d+)(?:\.(\d+))?/.exec(String(text || ''));
  if (!m) return null;
  const first = Number(m[1]);
  if (first === 1) return m[2] ? Number(m[2]) : null;      // 1.8.0_202 -> 8
  return Number.isFinite(first) ? first : null;
}

/* 包内运行时是 jlink 裁剪出来的，只含算法题会用到的标准库模块
   （java.base + jdk.compiler + charsets/zipfs/unsupported/random/logging）。
   写 `import java.awt.Point;` 这类图形/数据库/XML 的包时，javac 只会说
   「程序包java.awt不存在」—— 对零基础的人这句话像是"我的电脑坏了"，
   实际上是"这个包没随包带"。这里给它补一句人话。
   只在包内运行时补：系统装的完整 JDK 报同样的话，那才真是拼错了包名。 */
/* 被 jlink 裁掉的那些包，以及一句人话说明它是干什么的。
 *
 * ⚠ 这是一份**白名单**，不是"提示文案表"。只有落在这张表里的包名才会被解释成
 * 「运行时没带」；表外的一律原样返回 javac 的诊断。
 *
 * 为什么必须是白名单：零基础最常见的错就是包名拼错（java.utill / java.utils）。
 * 拼错时 javac 报的同样是「程序包 java.utill 不存在」，如果按前缀 java./javax. 一律
 * 解释成"不是你的错，是运行时精简过了"，学生会真的去装一个完整 JDK、再把 runtime\jdk 删掉，
 * 结果同一行还是编译不过 —— 排查方向被彻底带偏。
 * 反过来漏解释一个真被裁掉的包，代价只是"看到一条和完整 JDK 上一模一样的普通报错"，
 * 两种代价不对等，所以宁可漏、不可错。
 *
 * 加新条目时的判据：这个包在**完整 JDK 里有**，而 scripts/package.mjs 的 JLINK_MODULES
 * **没包含**它所属的模块。 */
const JDK_MODULE_HINT = {
  // java.desktop
  'java.awt': '图形界面', 'javax.swing': '图形界面', 'javax.imageio': '图像读写',
  'java.applet': '图形界面', 'javax.sound': '音频', 'java.beans': '图形界面配套',
  'javax.print': '打印', 'javax.accessibility': '无障碍',
  // java.sql / java.sql.rowset
  'java.sql': '数据库', 'javax.sql': '数据库',
  // java.xml / java.xml.crypto
  'javax.xml': 'XML', 'org.w3c.dom': 'XML', 'org.xml.sax': 'XML',
  // 其它没随包带的模块
  'java.rmi': '远程调用', 'javax.rmi': '远程调用',
  'javax.naming': '目录服务', 'javax.script': '脚本引擎',
  'java.net.http': 'HTTP 客户端',
  'javax.management': '运行时管理', 'java.lang.management': '运行时管理',
  'javax.transaction': '事务', 'javax.smartcardio': '智能卡',
  'javax.tools': '编译器 API', 'javax.lang.model': '编译器 API',
  'javax.annotation.processing': '注解处理器',
  'java.util.prefs': '用户偏好存储', 'java.lang.instrument': '字节码插桩',
  'javax.security.auth.kerberos': 'Kerberos', 'org.ietf.jgss': 'Kerberos',
};

export function explainMissingPackage(diagnostic, bundled) {
  if (!bundled || !diagnostic) return diagnostic;
  const names = new Set();
  // 中英两种 javac 诊断都认（诊断语言跟随系统 locale）
  for (const re of [/程序包\s*([\w.]+)\s*不存在/g, /package\s+([\w.]+)\s+does not exist/g]) {
    let m;
    while ((m = re.exec(diagnostic))) names.add(m[1]);
  }
  const hits = [];
  for (const n of names) {
    // 只认白名单里的（含子包）。认不出来的一律当成"学生自己拼错了"，什么都不加。
    const key = Object.keys(JDK_MODULE_HINT).find((k) => n === k || n.startsWith(k + '.'));
    if (!key) continue;
    hits.push(`${n}（${JDK_MODULE_HINT[key]}）`);
  }
  if (hits.length === 0) return diagnostic;
  return diagnostic
    + '\n\n———— 说明 ————\n'
    + `这不是你的代码写错了。本程序自带的是**精简版 Java 运行时**，只包含算法题会用到的标准库：\n`
    + 'java.lang / java.util（含 stream、function）/ java.io / java.math / java.text / java.time / java.util.regex 等。\n'
    + `${hits.join('、')} 不在其中，所以编译不过。\n`
    + '算法题几乎都能只用上面那些包写出来；确实需要完整 JDK 的话，\n'
    + '在本机装一个 JDK（推荐 17 及以上），然后把程序目录里的 runtime\\jdk 文件夹改名或删掉，\n'
    + '启动器就会改用你自己装的那个。';
}

/* ---------------- 编码 ---------------- */

// 只用于 javac 诊断：先严格按 UTF-8 试，真的不是合法 UTF-8 才回落 GBK。
// （不能用「结果里有没有 U+FFFD」来判断——合法 UTF-8 里本来就可能含 U+FFFD 字符。）
function decodeDiagnostic(buf) {
  if (!buf || buf.length === 0) return '';
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { try { return new TextDecoder('gbk').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); } }
}
const decodeUtf8 = (buf) => (buf && buf.length ? new TextDecoder('utf-8').decode(buf) : '');

/* ---------------- JDK 探测 ---------------- */

/* 必须是异步的：以前用 execFileSync，探测最坏要等 15 秒，
   而这段代码跑在 Vite 的事件循环上 —— 同步阻塞会把整个开发/预览服务器卡死。 */
export function detectJdk() {
  if (jdkCache && jdkCache.available) return Promise.resolve(jdkCache);   // 只缓存成功；否则装好 JDK 后不重启就一直说没有
  if (jdkProbe) return jdkProbe;                                          // 同时来两个请求也只探测一次
  jdkProbe = new Promise((resolve) => {
    const jh = resolveJavaHome();
    if (jh.bundled && !jh.ok) {
      jdkCache = {
        available: false, version: null, major: null, bundled: true,
        // ⚠ 这里**不能带路径**。这条 error 会原样出现在「📋 复制诊断信息」里，
        //   而使用者是要把那段文字粘到聊天窗口发给别人的 —— 打包版上这个路径长这样：
        //   C:\Users\<他的真名拼音>\Desktop\AlgoForge v1.0.1\runtime\jdk
        //   而那段文字最后一行还写着「不含任何本机路径」，等于当面骗他。
        //   要排查的话 server.log 里有完整路径，那个文件不会被粘到群里。
        error: '安装包内的 Java 运行时不完整。请把安装包重新完整解压一次（不要只解压一部分）。',
      };
      jdkProbe = null;
      resolve(jdkCache);
      return;
    }
    execFile(jh.javac, ['-J-Duser.language=en', '-version'], { timeout: 15000, windowsHide: true }, (err, stdout, stderr) => {
      // javac 在不同版本里把版本号写到 stdout 或 stderr，两边都看
      const msg = (String(stdout || '').trim() || String(stderr || '').trim());
      // bundled 让诊断信息能区分「用的是包内 JDK」还是「用的是他自己装的」
      jdkCache = { ...classifyJdk(err, msg), bundled: jh.bundled };
      jdkProbe = null;
      resolve(jdkCache);
    });
  });
  return jdkProbe;
}

/* ---------------- 源码分析 ---------------- */

/** 把注释与字符串/字符字面量替换成等长空格：保持所有下标与行号不变，便于后续正则安全匹配 */
function blankOutCommentsAndStrings(src) {
  const a = src.split('');
  let i = 0;
  const n = a.length;
  const blank = (from, to) => { for (let k = from; k < to && k < n; k++) if (a[k] !== '\n') a[k] = ' '; };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; }
    else if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; blank(i, Math.min(j + 2, n)); i = j + 2; }
    else if (c === '"' && src.slice(i, i + 3) === '"""') {           // 文本块
      let j = i + 3; while (j < n && src.slice(j, j + 3) !== '"""') j++; blank(i, Math.min(j + 3, n)); i = j + 3;
    } else if (c === '"' || c === "'") {
      // 加换行终止：未闭合字面量在 Java 里本来就只能影响一行，别让它吞掉整份文件
      let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; } blank(i, Math.min(j + 1, n)); i = j + 1;
    } else i++;
  }
  return a.join('');
}

/** 这个类型声明前面有没有 public 修饰符。注释与字符串已被抹白，所以只看紧邻的那一小段就够。 */
function isPublicAt(clean, at) {
  const before = clean.slice(Math.max(0, at - 120), at);
  const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}'));
  return /\bpublic\b/.test(before.slice(cut + 1));
}

/** 收集所有类型声明（含嵌套），并记下各自类体 { } 的范围，用来判断谁包着谁 */
function collectTypes(clean) {
  const re = /\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  const marks = [];
  let m;
  while ((m = re.exec(clean)) !== null) {
    marks.push({ name: m[2], at: m.index, pub: isPublicAt(clean, m.index), open: -1, close: -1 });
  }
  for (const mk of marks) {
    const open = clean.indexOf('{', mk.at);
    if (open < 0) continue;                 // 只有声明没有类体：忽略
    mk.open = open;
    mk.close = clean.length;                // 大括号没配平（代码写了一半）时当作延伸到文件末尾
    let d = 0;
    for (let i = open; i < clean.length; i++) {
      const ch = clean[i];
      if (ch === '{') d++;
      else if (ch === '}' && --d === 0) { mk.close = i; break; }
    }
  }
  return marks;
}

/** 找出顶层类型声明、以及**真正**含 main 的那个类型（可能是嵌套类）；顺带取 package */
export function analyzeSource(src) {
  const clean = blankOutCommentsAndStrings(src);
  const pkgM = clean.match(/^[ \t]*package\s+([\w.]+)\s*;/m);
  const pkg = pkgM ? pkgM[1] : null;

  const marks = collectTypes(clean);
  const wraps = (outer, at) => outer.open >= 0 && outer.open < at && at < outer.close;
  const types = marks.filter((mk) => !marks.some((o) => o !== mk && wraps(o, mk.at)));   // 顶层 = 没被别人包着

  // main 方法的位置（可能有多个，取第一个）
  // 修饰符按集合匹配：public static final void main / static public void main 都合法
  const mainM = /(?:^|[;{}\s])((?:(?:public|protected|private|static|final|synchronized|strictfp)\s+)+)void\s+main\s*\(/.exec(clean);
  const mainHasStatic = mainM ? /\bstatic\b/.test(mainM[1]) : false;
  // 正则头上吃掉了一个分隔符，要跳过它：main 紧贴类体左括号时（class A{public static void main…），
  // 匹配位置正好等于该类的 open，不跳过就会判成"不在这个类里面"。
  const mainAt = mainM ? mainM.index + (/^[;{}\s]/.test(mainM[0]) ? 1 : 0) : -1;

  let mainClass = null;   // 最外层类型名：没有 public 类时用它给文件命名
  let mainType = null;    // 二进制名：main 在嵌套类里就得是 Outer$Inner，否则 java 启动的是外层类
  if (mainAt >= 0 && mainHasStatic) {
    const chain = marks.filter((mk) => wraps(mk, mainAt)).sort((x, y) => x.open - y.open);
    if (chain.length) {
      mainClass = chain[0].name;
      mainType = chain.map((mk) => mk.name).join('$');
    }
  }
  if (!mainClass && types.length) { mainClass = types[0].name; mainType = types[0].name; }

  // public 顶层类必须写在同名文件里，否则 javac 直接拒编译 —— 文件名要按它来，而不是按"含 main 的类"
  const pub = types.find((t) => t.pub);
  return {
    pkg, mainClass, mainType, hasMain: !!(mainM && mainHasStatic),
    topLevelTypes: types.map((t) => t.name),
    publicType: pub ? pub.name : null,
  };
}

/* ---------------- 进程执行 ---------------- */

function runProc(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      // stdin 给 'ignore'：否则它是一条永不关闭的管道，任何读 System.in 的程序
      // 都会一直等到 8 秒超时并被误报成「死循环」。给 ignore 后 Scanner 立刻拿到 EOF。
      child = spawn(cmd, args, { cwd: WORK_DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: Buffer.from(String(e.message || e)), timedOut: false, truncated: false });
      return;
    }
    const outChunks = []; const errChunks = [];
    let outBytes = 0; let errBytes = 0; let truncated = false;
    let settled = false; let timedOut = false;
    let killTimer = null;

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer);
      resolve({ code, stdout: Buffer.concat(outChunks), stderr: Buffer.concat(errChunks), timedOut, truncated });
    };

    const hardKill = () => {
      try {
        if (process.platform === 'win32') {
          // execFile 的回调会吸收 taskkill 自身的错误，不会抛异步 error 崩掉 Vite
          execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => {});
        } else { child.kill('SIGKILL'); }
      } catch { /* ignore */ }
      // 孙进程可能仍持有 stdout 管道导致 'close' 永不触发 —— 给个宽限后无条件收尾
      if (!killTimer) killTimer = setTimeout(() => finish(-1), KILL_GRACE_MS);
    };

    const timer = setTimeout(() => { timedOut = true; hardKill(); }, Math.max(200, timeoutMs));

    child.stdout.on('data', (d) => {
      if (outBytes >= MAX_OUTPUT_BYTES) return;
      outBytes += d.length; outChunks.push(d);
      if (outBytes >= MAX_OUTPUT_BYTES) { truncated = true; hardKill(); }
    });
    child.stderr.on('data', (d) => {
      if (errBytes >= MAX_OUTPUT_BYTES) return;
      errBytes += d.length; errChunks.push(d);
      if (errBytes >= MAX_OUTPUT_BYTES) { truncated = true; hardKill(); }
    });
    child.on('error', (e) => { errChunks.push(Buffer.from(String(e.message || e))); finish(-1); });
    child.on('close', (code) => finish(code));
  });
}

/** 用 javac 真实产出的 .class 校正一次类名。
 *  局部类的二进制名带序号（Outer$1Local），光看源码推不出来；把 $ 后面的数字去掉再匹配一次。
 *  匹配不上就原样返回，让 JVM 自己报错 —— 它那句"在类 X 中找不到 main 方法"已经够清楚了。 */
function resolveCompiledClass(runClass) {
  const seg = runClass.split('.');
  const simple = seg[seg.length - 1];
  const dir = seg.length > 1 ? join(OUT_DIR, ...seg.slice(0, -1)) : OUT_DIR;
  if (existsSync(join(dir, simple + '.class'))) return runClass;
  let names;
  try { names = readdirSync(dir).filter((f) => f.endsWith('.class')).map((f) => f.slice(0, -6)); }
  catch { return runClass; }
  const norm = (n) => n.split('$').map((p) => p.replace(/^\d+/, '')).join('$');
  const hit = names.find((n) => norm(n) === simple);
  return hit ? seg.slice(0, -1).concat(hit).join('.') : runClass;
}

/* ---------------- 主流程 ---------------- */

const SAFE_CLASS = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export const MAX_JUDGE_CASES = 2000;

/** 判题外壳认识的比较方式（Hot100Judge.compare）。漏一个，那道题在程序里就是 400 */
export const COMPARE_MODES = ['exact', 'unordered', 'set_of_sets', 'balanced_bst'];

/** judge 是从浏览器来的，落进 Java 源码之前逐字段校验（JSON.stringify 之外再加一道）
 *
 * ⚠ 这里必须**原样转发 javaJudgeSpec（shared/judgeSpec.js）给的每一个字段**，只校验、不挑拣。
 *   以前这里只挑了 methodName / marker / compareMode / inPlace / cases 五个往下传 ——
 *   和 2026-09-16 修掉的那个界面 bug 是同一个坑，只是挪到了服务端：
 *     · design 丢了、设计类的用例又没有 args → LRU 缓存 / Trie / 最小栈 / 数据流中位数直接 400
 *     · balanced_bst 不在白名单 → 将有序数组转换为二叉搜索树 400
 *     · nodeIndexOut / nodeValueOut / randomList 丢了 → 相交链表、环形链表 II、最近公共祖先 0 分，随机链表的复制编译不过
 *   这 9 道题的 Java 判题在程序里**连官方参考解都过不了**，而 verify-java.mjs 直接调 buildJudgeFiles、
 *   不经过这里，所以一直报 100/100。（2026-10-16 做「签名和力扣一致」时顺着链路走到这里才发现。）
 *   scripts/test-judgespec.mjs 现在逐题核对：spec 过一遍 JSON + 这个函数之后，必须和原来一模一样。 */
export function validateJudge(j) {
  if (j == null) return null;                                   // 没传 = 自由运行
  if (typeof j !== 'object') return { error: 'judge 必须是对象' };
  if (typeof j.methodName !== 'string' || !SAFE_CLASS.test(j.methodName)) return { error: 'judge.methodName 非法' };
  if (typeof j.marker !== 'string' || !/^[A-Za-z0-9_]{4,64}$/.test(j.marker)) return { error: 'judge.marker 非法' };
  const mode = j.compareMode || 'exact';
  if (!COMPARE_MODES.includes(mode)) return { error: 'judge.compareMode 非法' };
  if (!Array.isArray(j.cases) || j.cases.length === 0) return { error: 'judge.cases 不能为空' };
  // 每题 = 示例 + 隐藏用例 + 几百组随机数据（shared/caseGen.js），实际最多三百多条；上限只是防滥用
  if (j.cases.length > MAX_JUDGE_CASES) return { error: 'judge.cases 过多' };
  const design = !!j.design;
  for (const c of j.cases) {
    // 设计类的用例是一串调用（ops/callArgs），其余的是一组实参（args）—— 见 casesFromProblem
    const shapeOk = c && typeof c === 'object'
      && (design ? Array.isArray(c.ops) && Array.isArray(c.callArgs) : Array.isArray(c.args));
    if (!shapeOk) return { error: 'judge.cases 里有格式不对的用例' };
  }
  // 签名会被拼进 Java 源码：这里先挡长度和类型，真正的语法校验在 parseJavaSignature（只认标识符和几个括号）
  if (j.signature != null && (typeof j.signature !== 'string' || j.signature.length > 600)) return { error: 'judge.signature 非法' };
  // 效率测试：题号必须是有生成器的那几道（服务端按它现场生成大数据）；摘要必须是 16 位十六进制
  if (j.perf != null) {
    const p = j.perf;
    if (typeof p !== 'object' || typeof p.id !== 'string' || !Object.prototype.hasOwnProperty.call(PERF, p.id)) return { error: 'judge.perf 非法' };
    if ('digest' in p && !(typeof p.digest === 'string' && /^[0-9a-f]{16}$/.test(p.digest))) return { error: 'judge.perf.digest 非法' };
  }
  return {
    ok: {
      methodName: j.methodName,
      compareMode: mode,
      inPlace: !!j.inPlace,
      design,
      nodeIndexOut: !!j.nodeIndexOut,
      nodeValueOut: !!j.nodeValueOut,
      randomList: !!j.randomList,
      randomListOut: !!j.randomListOut,
      cases: j.cases,
      signature: j.signature == null ? null : j.signature,
      perf: j.perf == null ? null : j.perf,
      marker: j.marker,
    },
  };
}

export async function handleRun(code, judge) {
  const jdk = await detectJdk();
  if (!jdk.available) return { ok: false, phase: 'jdk', message: jdk.error };
  const jh = resolveJavaHome();          // 包内运行时优先，见 resolveJavaHome 的说明

  const info = analyzeSource(code);
  let files;
  let runClass;
  let leetcode = null;                   // 判题时「按力扣的方式调用一次」的那个文件，见 java-harness 的 buildLeetCodeCall
  const budget = judge ? JUDGE_BUDGET_MS : TOTAL_BUDGET_MS;

  if (judge) {
    const built = buildJudgeFiles(code, info, judge);
    if (built.error) return { ok: false, phase: 'compile', stderr: built.error };
    files = built.files;
    runClass = built.mainClass;
    leetcode = built.leetcode || null;
  } else {
    if (!info.mainClass) {
      return { ok: false, phase: 'compile', stderr: '没找到 class 声明。请至少写一个类，例如：\npublic class Solution { public static void main(String[] args) { ... } }' };
    }
    if (!info.hasMain) {
      return { ok: false, phase: 'compile', stderr: '没找到 main 方法。当前为「自由运行」模式，请写一个 public static void main(String[] args) 并在里面调用你的解法。' };
    }
    // 文件名必须跟 public 类走：写了 public class Foo 却存成 Bar.java，javac 会直接拒绝
    files = [{ name: `${info.publicType || info.mainClass}.java`, content: withAutoImports(code, info) }];   // 和力扣一样自动导入 java.util.*，见 java-harness
    runClass = info.pkg ? `${info.pkg}.${info.mainType}` : info.mainType;
  }

  for (const f of files) {
    if (!SAFE_CLASS.test(f.name.replace(/\.java$/, ''))) {
      return { ok: false, phase: 'compile', stderr: '类名不合法：' + f.name };
    }
  }

  try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  mkdirSync(SRC_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const paths = files.map((f) => {
    const p = join(SRC_DIR, f.name);
    writeFileSync(p, f.content, 'utf8');
    return p;
  });

  const deadline = Date.now() + budget;             // 编译+运行共享一份预算

  const c = await runProc(jh.javac, ['-encoding', 'UTF-8', '-d', OUT_DIR, ...paths], deadline - Date.now());
  if (c.timedOut) return { ok: false, phase: 'compile', timedOut: true };
  if (c.code !== 0) {
    const raw = decodeDiagnostic(Buffer.concat([c.stderr, c.stdout]));
    let clean = stripAutoImports(raw.split(SRC_DIR + '\\').join('').split(SRC_DIR + '/').join(''));   // 不泄漏临时目录
    if (leetcode) {
      /* 学生代码自己没错、只有「按力扣方式调用」的文件编不过 —— 签名和力扣对不上，力扣上会编译失败。
         学生代码自己有错时只给他看他自己的：调用文件的报错多半是连带的，只会添乱。 */
      const sep = splitLeetCodeCallDiag(clean, leetcode);
      if (sep.userErrors === 0 && sep.callErrors > 0) {
        return { ok: false, phase: 'compile', signature: true, stderr: explainLeetCodeCall(sep.failures, leetcode, leetcode.sig, code), mainClass: info.mainClass };
      }
      clean = sep.rest;
    }
    return { ok: false, phase: 'compile', stderr: explainMissingPackage(clean, jh.bundled), mainClass: info.mainClass };
  }

  // 编译成功后再校正一次类名（局部类的二进制名带序号，源码里看不出来）
  if (!judge) runClass = resolveCompiledClass(runClass);

  const left = deadline - Date.now();
  if (left <= 200) return { ok: false, phase: 'run', timedOut: true, mainClass: runClass };

  const r = await runProc(jh.java, [
    // 新旧两套属性名都传：stdout.encoding 是 JDK 19+ 的名字，sun.stdout.encoding 是 18 及更早的。
    // 只传新的，在 JDK 18 上会被静默忽略 —— 中文输出直接变乱码，而且不报任何错。
    '-Dstdout.encoding=UTF-8', '-Dstderr.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8', '-Dsun.stderr.encoding=UTF-8',
    '-Xmx256m', '-XX:+UseSerialGC',
    /* 栈和力扣对齐（2026-10-17 用户在力扣上实测）：力扣上最简单的递归能到 416 万层、带参数的递归 10 万层没问题；
       本机默认栈只有 1.8 万层、带参数的递归 5 万层就栈溢出 —— 递归写法会「力扣能过、本地栈溢出」。
       128MB 实测 624 万层，略宽于力扣（宁宽勿严：题目规模最多 10 万，碰不到这点差别）。
       只是预留的地址空间，用多少才真正占多少内存。效率测试的线程不指定栈大小，用的也是这个值。 */
    '-Xss128m',
    '-cp', OUT_DIR, runClass,
  ], left);

  return {
    ok: !r.timedOut && !r.truncated && r.code === 0,
    phase: 'run',
    judged: !!judge,
    timedOut: r.timedOut,
    truncated: r.truncated,
    // 被强杀时 r.code 是 taskkill 的退出码而不是程序的，别拿去报「运行出错(退出码 1)」
    exitCode: r.truncated ? null : r.code,
    // 判题结果按行解析，Windows 的 CRLF 会给行尾留个 \r，这里统一成 LF
    stdout: decodeUtf8(r.stdout).split('\r\n').join('\n'),      // java 侧已强制 UTF-8，不做猜测
    stderr: decodeUtf8(r.stderr).split('\r\n').join('\n'),
    mainClass: runClass,
  };
}

/* ---------------- HTTP ---------------- */

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let done = false;
    const to = setTimeout(() => { if (!done) { done = true; reject(Object.assign(new Error('读取请求体超时'), { status: 408 })); } }, BODY_TIMEOUT_MS);
    const fin = (fn, v) => { if (done) return; done = true; clearTimeout(to); fn(v); };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      // 超限不立刻 destroy：先让 400/413 正常回出去，否则前端只看到连接重置
      if (size > limit) { fin(reject, Object.assign(new Error('代码过大（上限 200KB）'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => fin(resolve, Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => fin(reject, e));
  });
}

export const json = (res, status, obj) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
};

/** 拒绝跨站：浏览器无法伪造 Origin / Sec-Fetch-Site，这能挡住「任意网页驱动本机执行代码」。
 *  导出给 server/env-api.mjs 复用 —— 新端点必须走同一道门，不能各写一份。 */
export function crossSiteRejected(req, res) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    json(res, 403, { ok: false, message: '拒绝跨站请求' });
    return true;
  }
  const origin = req.headers.origin;
  if (origin) {
    // 与实际 Host 比对而非硬编码白名单：否则用 127.0.0.1 / IPv6 回环 / 改过端口打开时，
    // 同源请求会被 403，前端还会把它误诊成「未检测到 JDK」。
    let sameHost = false;
    try { sameHost = new URL(origin).host === req.headers.host; } catch { sameHost = false; }
    if (!sameHost && !ALLOWED_ORIGINS.has(origin)) {
      json(res, 403, { ok: false, message: '拒绝来自 ' + origin + ' 的请求' });
      return true;
    }
  }
  return false;
}

export default function javaRunnerPlugin() {
  const attach = (server) => {
    server.middlewares.use('/api/java/status', (req, res, next) => {
      if (req.url.split('?')[0] !== '/') return next();
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, message: '只接受 GET' });
      if (crossSiteRejected(req, res)) return;
      detectJdk().then((d) => json(res, 200, d));
    });

    server.middlewares.use('/api/java/run', async (req, res, next) => {
      if (req.url.split('?')[0] !== '/') return next();
      if (req.method !== 'POST') return json(res, 405, { ok: false, message: '只接受 POST' });
      if (crossSiteRejected(req, res)) return;
      // 简单表单 POST 无法设置这个 Content-Type，等于再加一道 CSRF 防线
      if (!String(req.headers['content-type'] || '').includes('application/json')) {
        return json(res, 415, { ok: false, message: 'Content-Type 必须是 application/json' });
      }

      let payload;
      try {
        const raw = await readBody(req, MAX_CODE_BYTES);      // 解析阶段无副作用，不占 busy
        payload = JSON.parse(raw);
      } catch (e) {
        return json(res, e.status || 400, { ok: false, message: String(e.message || e) });
      }
      if (typeof payload?.code !== 'string' || !payload.code.trim()) {
        return json(res, 400, { ok: false, message: '缺少 code 字段' });
      }
      const jv = validateJudge(payload.judge);
      if (jv && jv.error) return json(res, 400, { ok: false, message: jv.error });

      if (busy) return json(res, 429, { ok: false, phase: 'busy', message: '上一次运行还没结束，请稍候' });
      busy = true;
      try {
        return json(res, 200, await handleRun(payload.code, jv ? jv.ok : null));
      } catch (e) {
        return json(res, 500, { ok: false, message: String(e.message || e) });
      } finally {
        busy = false;
      }
    });
  };

  return {
    name: 'hot100-java-runner',
    configureServer: attach,          // npm run dev
    configurePreviewServer: attach,   // npm run preview（桌面快捷方式走这条）
  };
}

export { WORK_DIR };
