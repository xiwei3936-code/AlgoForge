import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.GenericArrayType;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Hot100 判题外壳。
 *
 * 学生的代码单独放在 Solution.java 里，本文件是它的同伴文件 —— 这样 javac 的报错行号
 * 与编辑器完全一致（JDK 21 不支持多文件源码模式，所以只能这样分文件）。
 *
 * 核心设计：**完全靠反射**，不给每道题预配类型。
 *   - 读 Solution 里目标方法的 getParameterTypes() / getGenericParameterTypes()，
 *     把 JSON 用例按声明类型转成 int[] / char[][] / List&lt;List&lt;Integer&gt;&gt; / ListNode / TreeNode…
 *   - 链表、树结点不按类名识别，而按【字段形状】识别（val+next / val+left+right），
 *     所以学生自己贴一份 LeetCode 的 ListNode 定义也照样能判。
 *   - 返回值按运行时形状转回 JSON，再按 compareMode 比较。
 *
 * 输出协议与 Python 侧完全一致：每个用例打印一行 MARK + JSON，前后各加一个换行，
 * 这样学生自己 print 不换行也不会把结果行粘掉。前端复用同一个 parseTestResults。
 *
 * 文件里的 __XXX__ 是占位符，由 server/java-harness.mjs 在运行前替换。
 * 保留占位符原样时本文件依然是合法 Java，可以直接 javac 做语法检查。
 */
public class Hot100Judge {

    static final String MARK = "__MARK__";
    static final String METHOD = "__METHOD__";
    static final String MODE = "__MODE__";
    static final boolean INPLACE = Boolean.parseBoolean("__INPLACE__");
    /* 设计类（LRU / 最小栈 / Trie / 数据流中位数）：没有单一入口，
       用例是一串调用 —— ops[0] 是类名、其余是方法名，args 与之一一对应。
       结果是**每次调用的返回值序列**，构造与 void 记 null（和 LeetCode 的输出格式一致）。 */
    static final boolean DESIGN = Boolean.parseBoolean("__DESIGN__");
    /* 返回值是一个**结点**（环形链表 II 的环入口）：换算成它在输入链表里的下标再比。
       不能直接序列化整条链 —— 有环的话会转不出来。 */
    static final boolean OUT_NODE_IDX = Boolean.parseBoolean("__OUT_NODE_IDX__");
    /** 上一次建出来的链表结点，按顺序；给 OUT_NODE_IDX 换算下标用（按对象身份找，不是按值） */
    static List<Object> LAST_NODES = new ArrayList<Object>();
    /* 返回值是**树**里的一个结点（最近公共祖先）：取它的值。
       这道题题目保证结点值互不相同，所以按值比是充分的；
       而 OUT_NODE_IDX 找的是链表结点表，对树不适用。 */
    static final boolean OUT_NODE_VAL = Boolean.parseBoolean("__OUT_NODE_VAL__");
    /** 上一次建出来的树根；给 {"__node": v} 在里面按值找结点用 */
    static Object LAST_TREE = null;
    /* 随机链表：序列化成 [[val, randomIdx], …]。只比 val 的话，
       浅拷贝和深拷贝长得一模一样，用例照样通过、什么都没测。 */
    static final boolean OUT_RAND = Boolean.parseBoolean("__OUT_RAND__");
    /* 设计类里**力扣签名返回 void** 的方法名，逗号分隔（来自 shared/javaSignatures.js）。
       这些方法的返回值一律记 null —— 力扣就是这么做的：它按自己的签名 obj.put(k, v); 调用，返回值直接丢掉。
       不这样的话，LinkedHashMap 版的 LRU 缓存（只写 get、put 直接继承）会被判错：
       继承来的 put 返回 Integer（被覆盖的旧值），一遇到「同一个 key 再 put 一次」就输出 1 而不是 null。
       力扣能过、本地不过。 */
    static final String VOID_METHODS = "__VOID__";
    /* 效率测试：开了的话，**最后一条**用例是按力扣数据范围上限现场生成的大数据（shared/caseGen.js 的 PERF）。
       只有前面的用例全部通过才跑（力扣也是错一条就停）；放在单独的线程里，
       超过 PERF_CAP_MS 还没跑完就直接给结论、结束进程 —— 等服务端的总预算把整个进程杀掉，结论要多等好几秒。 */
    static final boolean PERF = Boolean.parseBoolean("__PERF__");
    static final long PERF_CAP_MS = longOr("__PERF_CAP__", 2000);
    /** 计时只算学生代码，但线程里还有转换输入的时间：多等这么久再判「没跑完」 */
    static final long PERF_SLACK_MS = 1000;

    static long longOr(String s, long fallback) {
        try { return Long.parseLong(s); } catch (NumberFormatException e) { return fallback; }
    }
    static final String[] CASES_PARTS = { "__CASES__" };

    static final String NL = String.valueOf((char) 10);
    /** ArrayDeque 不允许放 null，用一个哨兵表示"树里的空位" */
    static final Object HOLE = new Object();

    /** 判题没法进行下去（不是学生代码抛的异常），走 stderr + 退出码 3 */
    static class Fatal extends RuntimeException {
        Fatal(String m) { super(m); }
    }

    public static void main(String[] argv) {
        try {
            run();
        } catch (Fatal f) {
            System.err.println(f.getMessage());
            System.out.flush();
            System.exit(3);
        } catch (Throwable t) {
            System.err.println("判题程序内部错误：" + t);
            System.out.flush();
            System.exit(4);
        }
        System.out.flush();
    }

    static void run() throws Exception {
        StringBuilder b64 = new StringBuilder();
        for (String part : CASES_PARTS) {
            b64.append(part);
        }
        String json = new String(Base64.getDecoder().decode(b64.toString()), StandardCharsets.UTF_8);
        List<Object> cases = asList(Json.parse(json), "用例数据");

        if (DESIGN) { runDesign(cases); return; }

        Class<?> sol = findSolutionClass();
        Method method = findMethod(sol, cases);
        // 构造函数在循环外就先查好：缺无参构造是"根本没法开始判"的问题，
        // 应当一次说清楚，而不是每条用例都报一遍同样的错。
        Constructor<?> ctor = Modifier.isStatic(method.getModifiers()) ? null : solutionCtor(sol);

        final Method m0 = method;
        final Constructor<?> k0 = ctor;
        runAll(cases, new OneCase() {
            public Map<String, Object> run(int i, Map<String, Object> c) { return judgeOne(i, c, m0, k0); }
        });
    }

    /** 判一条（非设计类）用例，返回要打印的那一行 */
    static Map<String, Object> judgeOne(int i, Map<String, Object> c, Method method, Constructor<?> ctor) {
        List<Object> rawArgs = asList(c.get("args"), "用例参数");
        Object expected = c.get("expected");

        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("i", Long.valueOf(i));
        try {
            Object[] args = coerceArgs(method, rawArgs);
            Object inst = ctor == null ? null : ctor.newInstance();   // 每条用例都用一个全新的 Solution，与 Python 侧一致
            long t0 = System.nanoTime();      // 计时只包住学生的代码：转换输入、比答案的时间不算
            Object ret = method.invoke(inst, args);
            double ms = (System.nanoTime() - t0) / 1e6;
            // in-place 题：答案是"调用之后第一个参数变成了什么"
            Object resultObj = INPLACE ? (args.length > 0 ? args[0] : null) : ret;
            Class<?> declared = INPLACE
                ? (method.getParameterTypes().length > 0 ? method.getParameterTypes()[0] : null)
                : method.getReturnType();
            /* 返回结点 → 下标（按对象身份找）。环形链表 II 的返回值落在环里，
               直接序列化会转不出来；按值找又会在有重复值时认错。 */
            Object actual = OUT_RAND ? randomListToPairs(resultObj)
                : OUT_NODE_IDX ? Long.valueOf(nodeIndexOf(resultObj))
                : OUT_NODE_VAL ? nodeVal(resultObj)
                : toJsonTyped(resultObj, declared);
            boolean dg = Boolean.TRUE.equals(c.get("digest"));
            if (dg) actual = digest(actual);   // 效率测试的答案太大时只比摘要
            out.put("passed", Boolean.valueOf(compare(actual, expected, dg ? "exact" : MODE)));
            out.put("actual", actual);
            out.put("expected", expected);
            out.put("ms", Double.valueOf(Math.round(ms * 1000) / 1000.0));
        } catch (InvocationTargetException e) {
            out.put("passed", Boolean.FALSE);
            out.put("error", stackOf(e.getCause() == null ? e : e.getCause()));
        } catch (Fatal f) {
            out.put("passed", Boolean.FALSE);
            out.put("error", f.getMessage());
        } catch (Throwable t) {
            out.put("passed", Boolean.FALSE);
            out.put("error", stackOf(t));
        }
        return out;
    }

    interface OneCase {
        Map<String, Object> run(int i, Map<String, Object> c);
    }

    static void emit(Map<String, Object> out) {
        System.out.print(NL + MARK + Json.write(out) + NL);
        System.out.flush();
    }

    /** 依次判每条用例；开了效率测试的话，最后一条是它 —— 前面全部通过才跑，见 runPerf */
    static void runAll(List<Object> cases, OneCase one) {
        int n = cases.size() - (PERF ? 1 : 0);
        boolean allPassed = true;
        for (int i = 0; i < n; i++) {
            Map<String, Object> out = one.run(i, asMap(cases.get(i), "用例"));
            if (!Boolean.TRUE.equals(out.get("passed"))) allPassed = false;
            emit(out);
        }
        if (PERF && n >= 0 && allPassed) runPerf(n, asMap(cases.get(n), "效率测试用例"), one);
    }

    static void runPerf(final int i, final Map<String, Object> c, final OneCase one) {
        final Object[] box = new Object[1];
        Thread t = new Thread(new Runnable() {
            public void run() { box[0] = one.run(i, c); }
        }, "perf");
        t.setDaemon(true);
        t.start();
        try { t.join(PERF_CAP_MS + PERF_SLACK_MS); } catch (InterruptedException e) { /* 主线程不会被打断 */ }
        boolean stillRunning = t.isAlive();
        Map<String, Object> out;
        if (!stillRunning && box[0] != null) {
            @SuppressWarnings("unchecked")
            Map<String, Object> got = (Map<String, Object>) box[0];
            out = got;
        } else {
            out = new LinkedHashMap<String, Object>();
            out.put("i", Long.valueOf(i));
            out.put("passed", Boolean.FALSE);
            if (stillRunning) out.put("timedOut", Boolean.TRUE);
            else out.put("error", "效率测试没能跑完（判题程序出错）");
        }
        out.put("perf", Boolean.TRUE);
        emit(out);
        if (stillRunning) Runtime.getRuntime().halt(0);   // 学生代码还在跑：结论已经给出，直接结束进程
    }

    /** 规范 JSON 的 SHA-256 前 16 位 —— 和 shared/caseGen.js 的 canonicalJson（Node）、src/judge.js（Python）同一个规则 */
    static String digest(Object v) throws Exception {
        byte[] h = java.security.MessageDigest.getInstance("SHA-256").digest(canonicalJson(v, MODE).getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (int k = 0; k < 8; k++) sb.append(String.format("%02x", h[k] & 0xff));
        return sb.toString();
    }

    /** unordered / set_of_sets：元素各自写成 JSON、按字符串排序后再拼（顺序无关）；其余照常写 */
    static String canonicalJson(Object v, String mode) {
        if (("unordered".equals(mode) || "set_of_sets".equals(mode)) && v instanceof List) {
            List<String> parts = new ArrayList<String>();
            for (Object e : (List<?>) v) {
                parts.add("set_of_sets".equals(mode) && e instanceof List ? canonicalJson(e, "unordered") : Json.write(e));
            }
            Collections.sort(parts);
            return "[" + String.join(",", parts) + "]";
        }
        return Json.write(v);
    }

    /* ---------------- 设计类：按调用序列驱动 ----------------
     * 这类题（LRU 缓存 / 最小栈 / Trie / 数据流的中位数）没有单一入口：
     *   ops  = ["LRUCache", "put",  "get"]      第一个是**类名**，其余是方法名
     *   args = [[2],        [1,1],  [1]  ]      与之一一对应
     * 结果是**每次调用的返回值序列**，构造与 void 记 null —— 和 LeetCode 的输出格式一致，
     * 学生对着题面一眼能看出是第几步开始不对的。
     *
     * 每条用例都新建一个对象：设计类是有状态的，一条用例的残留会污染下一条，
     * 而那种错最难查（单独跑都对，连起来跑就错）。 */

    static void runDesign(List<Object> cases) {
        runAll(cases, new OneCase() {
            public Map<String, Object> run(int i, Map<String, Object> c) { return designOne(i, c); }
        });
    }

    static boolean isScalar(Object r) {
        return r instanceof Number || r instanceof Boolean || r instanceof Character || r instanceof String;
    }

    /** 判一条设计类用例（一串调用） */
    static Map<String, Object> designOne(int i, Map<String, Object> c) {
        Object expected = c.get("expected");
        Map<String, Object> out = new LinkedHashMap<String, Object>();
        out.put("i", Long.valueOf(i));
        try {
            List<Object> ops = asList(c.get("ops"), "调用序列 ops");
            List<Object> callArgs = asList(c.get("callArgs"), "调用参数 args");
            if (ops.size() != callArgs.size()) {
                throw new Fatal("ops 和 args 条数对不上：" + ops.size() + " vs " + callArgs.size());
            }
            if (ops.isEmpty()) {
                throw new Fatal("这条用例一个调用都没有");
            }

            String clsName = String.valueOf(ops.get(0));
            Class<?> cls;
            try {
                cls = Class.forName(clsName);
            } catch (ClassNotFoundException e) {
                throw new Fatal("没有找到 class " + clsName + "。"
                    + NL + "这道题要求你写一个叫 " + clsName + " 的类（和 LeetCode 一样），并且写在最外层（不要嵌在别的类里面）。");
            }

            List<Object> ctorArgs = asList(callArgs.get(0), "构造参数");
            Constructor<?> ctor = findCtor(cls, clsName, ctorArgs.size());
            Object[] ctorArgv = coerceList(ctor.getParameterTypes(), ctor.getGenericParameterTypes(), ctorArgs, clsName + " 的构造函数");

            /* 计时之前先把每一次调用要用的方法和实参都准备好（反射查找、JSON 转成 Java 类型）：
               效率测试一条用例就有 20 万次调用，这些判题程序自己的开销要是算进去，
               能占到测出来那个时间的大半（实测：参考解的 LRU 缓存 200 ms 里大部分是它）。
               方法查找按「方法名/参数个数」缓存。 */
            int n = ops.size();
            Method[] calls = new Method[n];
            Object[][] argv = new Object[n][];
            boolean[] asNull = new boolean[n];
            Map<String, Method> found = new java.util.HashMap<String, Method>();
            for (int k = 1; k < n; k++) {
                String mname = String.valueOf(ops.get(k));
                List<Object> a = asList(callArgs.get(k), mname + " 的参数");
                String sigKey = mname + "/" + a.size();
                Method m = found.get(sigKey);
                if (m == null) { m = findNamedMethod(cls, clsName, mname, a.size()); found.put(sigKey, m); }
                calls[k] = m;
                argv[k] = coerceList(m.getParameterTypes(), m.getGenericParameterTypes(), a, mname);
                boolean lcVoid = ("," + VOID_METHODS + ",").contains("," + mname + ",");
                asNull[k] = m.getReturnType() == void.class || lcVoid;
            }

            Object[] raw = new Object[n];
            List<Object> early = new ArrayList<Object>(java.util.Collections.nCopies(n, null));
            long t0 = System.nanoTime();
            Object obj = ctor.newInstance(ctorArgv);
            for (int k = 1; k < n; k++) {
                Object r = calls[k].invoke(obj, argv[k]);
                // 返回的是数字 / 布尔 / 字符串：调完再转成 JSON（不算时间）。
                // 返回的是对象（比如列表）就当场转：后面的调用可能还会改它，等到最后再转就不是当时的样子了
                if (!asNull[k] && r != null && !isScalar(r)) early.set(k, toJsonTyped(r, calls[k].getReturnType()));
                else raw[k] = r;
            }
            double ms = (System.nanoTime() - t0) / 1e6;

            List<Object> got = new ArrayList<Object>();
            got.add(null);                       // new 出来那一步没有返回值
            for (int k = 1; k < n; k++) {
                if (asNull[k]) got.add(null);
                else if (early.get(k) != null) got.add(early.get(k));
                else got.add(toJsonTyped(raw[k], calls[k].getReturnType()));
            }
            boolean dg = Boolean.TRUE.equals(c.get("digest"));
            Object actual = dg ? digest(got) : got;   // 效率测试的答案太大时只比摘要
            out.put("passed", Boolean.valueOf(compare(actual, expected, dg ? "exact" : MODE)));
            out.put("actual", actual);
            out.put("expected", expected);
            out.put("ms", Double.valueOf(Math.round(ms * 1000) / 1000.0));
        } catch (InvocationTargetException e) {
            out.put("passed", Boolean.FALSE);
            out.put("error", stackOf(e.getCause() == null ? e : e.getCause()));
        } catch (Fatal f) {
            out.put("passed", Boolean.FALSE);
            out.put("error", f.getMessage());
        } catch (Throwable t) {
            out.put("passed", Boolean.FALSE);
            out.put("error", stackOf(t));
        }
        return out;
    }

    static Object[] coerceList(Class<?>[] pt, Type[] gt, List<Object> raw, String where) {
        if (pt.length != raw.size()) {
            throw new Fatal(where + " 的参数个数不匹配：用例给了 " + raw.size() + " 个，你的写法需要 " + pt.length + " 个。");
        }
        Object[] out = new Object[pt.length];
        for (int i = 0; i < pt.length; i++) {
            out[i] = coerce(raw.get(i), pt[i], gt[i], where + " 的第 " + (i + 1) + " 个参数");
        }
        return out;
    }

    static Constructor<?> findCtor(Class<?> cls, String clsName, int arity) {
        for (Constructor<?> k : cls.getDeclaredConstructors()) {
            if (k.getParameterTypes().length == arity) { k.setAccessible(true); return k; }
        }
        throw new Fatal("你的 " + clsName + " 没有接受 " + arity + " 个参数的构造函数。"
            + NL + "请照题目要求的签名写（比如 LRUCache(int capacity)）。");
    }

    static Method findNamedMethod(Class<?> cls, String clsName, String name, int arity) {
        /* 先找类自己声明的（学生自己写的优先），找不到再找**继承来的**。
           只看 getDeclaredMethods 会误判一类完全正确的写法：
           LinkedHashMap 版的 LRU 缓存（Java 面试里最常见的那个答案）只重写 get、
           put 直接继承 —— 结果被告知"你的 LRUCache 里没有 put 这个方法（注意大小写）"，
           既判错了，提示还把人往"拼写错了"上引。
           （Python 侧的 getattr 自动走继承链，本来就没这个问题。） */
        Method hit = pickMethod(cls.getDeclaredMethods(), name, arity, clsName);
        if (hit == null) hit = pickMethod(cls.getMethods(), name, arity, clsName);
        if (hit == null) {
            boolean sawName = false;
            for (Method m : cls.getMethods()) if (m.getName().equals(name)) sawName = true;
            for (Method m : cls.getDeclaredMethods()) if (m.getName().equals(name)) sawName = true;
            throw new Fatal(sawName
                ? "你的 " + clsName + "." + name + " 参数个数不对：判题要调 " + arity + " 个参数的那个版本。"
                : "你的 " + clsName + " 里没有 " + name + " 这个方法（注意大小写）。");
        }
        hit.setAccessible(true);
        return hit;
    }

    /** 在一组方法里挑名字与参数个数都对的那个；桥接/合成方法只在没有别的候选时才用 */
    static Method pickMethod(Method[] ms, String name, int arity, String clsName) {
        Method real = null;
        Method bridge = null;
        for (Method m : ms) {
            if (!m.getName().equals(name) || m.getParameterTypes().length != arity) continue;
            if (m.isBridge() || m.isSynthetic()) {
                if (bridge == null) bridge = m;
                continue;
            }
            if (real != null && !sameParams(real, m)) {
                throw new Fatal("你的 " + clsName + " 里有多个都叫 " + name
                    + "、参数个数也都是 " + arity + " 的方法，判题分不清该调哪个。");
            }
            if (real == null) real = m;
        }
        return real != null ? real : bridge;
    }

    static boolean sameParams(Method a, Method b) {
        Class<?>[] x = a.getParameterTypes();
        Class<?>[] y = b.getParameterTypes();
        if (x.length != y.length) return false;
        for (int i = 0; i < x.length; i++) if (x[i] != y[i]) return false;
        return true;
    }

    /* ---------------- 找类 / 找方法 ---------------- */

    static Class<?> findSolutionClass() {
        try {
            return Class.forName("Solution");
        } catch (ClassNotFoundException e) {
            throw new Fatal("没有找到 class Solution。"
                + NL + "判题模式要求你的类名必须叫 Solution（和 LeetCode 一样），并且写在最外层（不要嵌在别的类里面）。");
        }
    }

    static Method findMethod(Class<?> sol, List<Object> cases) {
        int want = -1;
        if (!cases.isEmpty()) {
            want = asList(asMap(cases.get(0), "用例").get("args"), "用例参数").size();
        }

        List<Method> named = new ArrayList<Method>();
        List<String> allNames = new ArrayList<String>();
        for (Method m : sol.getDeclaredMethods()) {
            if (m.isSynthetic()) {
                continue;
            }
            if (!allNames.contains(m.getName())) {
                allNames.add(m.getName());
            }
            if (m.getName().equals(METHOD)) {
                named.add(m);
            }
        }
        if (named.isEmpty()) {
            Collections.sort(allNames);
            throw new Fatal("在 class Solution 里没有找到方法 " + METHOD + "(...)。"
                + NL + "这道题要求的方法名是：" + METHOD
                + NL + "你现在写的方法有：" + (allNames.isEmpty() ? "（一个都没有）" : String.join(", ", allNames))
                + NL + "Java 的方法名区分大小写，请照抄题目给的名字。");
        }

        List<Method> fit = new ArrayList<Method>();
        for (Method m : named) {
            if (m.getParameterCount() == want) {
                fit.add(m);
            }
        }
        if (fit.isEmpty()) {
            throw new Fatal("方法 " + METHOD + " 的参数个数不对。"
                + NL + "这道题的测试用例会传入 " + want + " 个参数，而你的 " + METHOD
                + " 声明了 " + named.get(0).getParameterCount() + " 个。");
        }
        // 同名同参数个数的重载很罕见；真出现就优先选 public 非 static 的那个
        Method best = fit.get(0);
        for (Method m : fit) {
            boolean better = Modifier.isPublic(m.getModifiers()) && !Modifier.isStatic(m.getModifiers());
            boolean bestOk = Modifier.isPublic(best.getModifiers()) && !Modifier.isStatic(best.getModifiers());
            if (better && !bestOk) {
                best = m;
            }
        }
        best.setAccessible(true);
        return best;
    }

    static Constructor<?> solutionCtor(Class<?> sol) {
        try {
            Constructor<?> k = sol.getDeclaredConstructor();
            k.setAccessible(true);
            return k;
        } catch (NoSuchMethodException e) {
            throw new Fatal("class Solution 需要一个无参构造函数（判题时会执行 new Solution()）。"
                + NL + "如果你写了带参数的构造函数，请再补一个 public Solution() {}。");
        }
    }

    /* ---------------- 入参转换（JSON -> 声明的 Java 类型） ---------------- */

    static Object[] coerceArgs(Method m, List<Object> raw) {
        /* 每条用例都要把这两个"上一次建了什么"清空。
           不清的话，第 2 条用例里的 {"__node": 5} 会跑去**上一条用例那棵树**里找结点，
           拿到一个不属于当前 root 的对象，参考解的 root == p 永远不成立、返回 null。
           这个错很阴：同一棵树的几条用例照样通过，只有换了树的那条才露馅。 */
        LAST_TREE = null;
        LAST_NODES = new ArrayList<Object>();
        Class<?>[] pt = m.getParameterTypes();
        Type[] gt = m.getGenericParameterTypes();
        if (pt.length != raw.size()) {
            throw new Fatal("参数个数不匹配：用例提供 " + raw.size() + " 个，方法需要 " + pt.length + " 个。");
        }
        Object[] out = new Object[pt.length];
        for (int i = 0; i < pt.length; i++) {
            out[i] = coerce(raw.get(i), pt[i], gt[i], "第 " + (i + 1) + " 个参数");
        }
        return out;
    }

    static Object coerce(Object v, Class<?> c, Type g, String where) {
        if (c == int.class || c == Integer.class) {
            return Integer.valueOf((int) num(v, where));
        }
        if (c == long.class || c == Long.class) {
            return Long.valueOf((long) num(v, where));
        }
        if (c == double.class || c == Double.class) {
            return Double.valueOf(num(v, where));
        }
        if (c == float.class || c == Float.class) {
            return Float.valueOf((float) num(v, where));
        }
        if (c == short.class || c == Short.class) {
            return Short.valueOf((short) num(v, where));
        }
        if (c == byte.class || c == Byte.class) {
            return Byte.valueOf((byte) num(v, where));
        }
        if (c == boolean.class || c == Boolean.class) {
            if (v instanceof Boolean) {
                return v;
            }
            throw new Fatal(where + " 需要 boolean，但用例里是 " + Json.write(v));
        }
        if (c == char.class || c == Character.class) {
            String s = str(v, where);
            if (s.length() != 1) {
                throw new Fatal(where + " 需要一个 char，但用例里是 " + Json.write(v));
            }
            return Character.valueOf(s.charAt(0));
        }
        if (c == String.class) {
            return v == null ? null : str(v, where);
        }
        if (c == Object.class) {
            /* 声明类型是 Object 的参数，几乎都来自**擦除后**的继承方法：
               LinkedHashMap.put(K,V) 到运行时是 put(Object,Object)。
               这时候整数必须装箱成 Integer 而不是原样返回 Json 解析出来的 Long ——
               学生的 map 是 Map<Integer,Integer>，Long(1).equals(Integer(1)) 是 false，
               表面现象是"put 进去了、size 也涨了，可 get 就是取不出来"，极难查。
               （这条以前不会被触发：只有设计类题目按方法名调继承来的方法才会走到 Object 参数。） */
            if (v instanceof Number) {
                double d = ((Number) v).doubleValue();
                if (d == Math.rint(d) && Math.abs(d) <= Integer.MAX_VALUE) {
                    return Integer.valueOf((int) d);
                }
                return Double.valueOf(d);
            }
            return v;
        }
        if (c.isArray()) {
            if (v == null) {
                return null;
            }
            List<Object> l = asList(v, where);
            Class<?> ct = c.getComponentType();
            Type gct = (g instanceof GenericArrayType) ? ((GenericArrayType) g).getGenericComponentType() : ct;
            Object arr = Array.newInstance(ct, l.size());
            for (int i = 0; i < l.size(); i++) {
                Array.set(arr, i, coerce(l.get(i), ct, gct, where + " 的第 " + (i + 1) + " 项"));
            }
            return arr;
        }
        if (Collection.class.isAssignableFrom(c)) {
            if (v == null) {
                return null;
            }
            List<Object> l = asList(v, where);
            Class<?> ec = Object.class;
            Type egt = Object.class;
            if (g instanceof ParameterizedType) {
                Type[] ta = ((ParameterizedType) g).getActualTypeArguments();
                if (ta.length == 1) {
                    egt = ta[0];
                    ec = rawOf(ta[0]);
                }
            }
            Collection<Object> col = Set.class.isAssignableFrom(c)
                ? new LinkedHashSet<Object>() : new ArrayList<Object>();
            for (Object e : l) {
                col.add(coerce(e, ec, egt, where + " 的元素"));
            }
            return col;
        }
        // 结点类型按【字段形状】识别，不认类名 —— 学生自己贴一份 ListNode 定义也能用
        if (isTreeNode(c)) {
            if (v == null) return null;
            /* {"__node": 5} 表示"已经建好的那棵树里值为 5 的**那个结点**"。
               最近公共祖先的 p/q 就是这样：把值另建成一棵单结点树是错的，
               参考解用 root == p 判身份，永远匹配不上。 */
            if (v instanceof Map) {
                Map<String, Object> m = asMap(v, where);
                if (m.containsKey("__node")) {
                    Object hit = findTreeNode(LAST_TREE, m.get("__node"));
                    if (hit == null) throw new Fatal(where + "：树里没有值为 " + m.get("__node") + " 的结点");
                    return hit;
                }
            }
            Object t = buildTree(c, asList(v, where));
            if (LAST_TREE == null) LAST_TREE = t;
            return t;
        }
        /* 必须排在 isListNode 前面：随机链表结点也有 val + next，
           先判 isListNode 的话会被当成普通链表建，random 全是 null。 */
        if (isRandomNode(c) && v instanceof Map && asMap(v, where).containsKey("__randomList")) {
            return buildRandomList(c, asList(asMap(v, where).get("__randomList"), where + " 的 __randomList"));
        }
        if (isListNode(c)) {
            if (v == null) return null;
            /* 带环的链表写成 {"__list":[3,2,0,-4], "cycle":1} —— JSON 写不出环，
               所以必须有这个显式编码；不然环形链表那两道只能造无环的用例，
               而它们的全部意义就在有环那一半。 */
            if (v instanceof Map) {
                Map<String, Object> m = asMap(v, where);
                List<Object> vals = asList(m.get("__list"), where + " 的 __list");
                long pos = m.get("cycle") == null ? -1L : (long) num(m.get("cycle"), where + " 的 cycle");
                List<Object> prev = LAST_NODES;          // 先存一份：下面这一步会把它改掉
                Object head = buildListWithCycle(c, vals, (int) pos);
                if (m.containsKey("__joinTo")) {
                    /* 相交链表：把这条链的尾巴接到**第一条链**的第 at 个结点上。
                       两条链从此共用同一段尾巴 —— JSON 写不出这种关系，
                       而这道题比的恰恰是"是不是同一个结点对象"。 */
                    int at = (int) num(m.get("__joinTo"), where + " 的 __joinTo");
                    joinTail(c, LAST_NODES, prev, at);
                    LAST_NODES = prev;                   // 答案要换算成"在第一条链里的第几个"
                }
                return head;
            }
            return buildList(c, asList(v, where));
        }
        if (v == null) {
            return null;
        }
        throw new Fatal(where + " 的类型是 " + c.getSimpleName() + "，判题程序不认识这个类型。"
            + NL + "请使用 LeetCode 官方的 Java 签名（int / int[] / int[][] / String / char[][] / List<Integer> / ListNode / TreeNode 等）。");
    }

    static Class<?> rawOf(Type t) {
        if (t instanceof Class) {
            return (Class<?>) t;
        }
        if (t instanceof ParameterizedType) {
            return (Class<?>) ((ParameterizedType) t).getRawType();
        }
        return Object.class;
    }

    static double num(Object v, String where) {
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        throw new Fatal(where + " 需要一个数字，但用例里是 " + Json.write(v));
    }

    static String str(Object v, String where) {
        if (v instanceof String) {
            return (String) v;
        }
        throw new Fatal(where + " 需要一个字符串，但用例里是 " + Json.write(v));
    }

    @SuppressWarnings("unchecked")
    static List<Object> asList(Object v, String where) {
        if (v instanceof List) {
            return (List<Object>) v;
        }
        throw new Fatal(where + " 应该是一个数组，但实际是 " + Json.write(v));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> asMap(Object v, String where) {
        if (v instanceof Map) {
            return (Map<String, Object>) v;
        }
        throw new Fatal(where + " 应该是一个对象，但实际是 " + Json.write(v));
    }

    /* ---------------- 结点类型：识别 / 构造 / 还原 ---------------- */

    static Field fieldOf(Class<?> c, String name) {
        try {
            Field f = c.getDeclaredField(name);
            f.setAccessible(true);
            return f;
        } catch (NoSuchFieldException e) {
            return null;
        }
    }

    static boolean isTreeNode(Class<?> c) {
        return fieldOf(c, "val") != null && fieldOf(c, "left") != null && fieldOf(c, "right") != null;
    }

    /** 随机链表结点：val + next + random 三个字段都有 */
    static boolean isRandomNode(Class<?> c) {
        return hasField(c, "val") && hasField(c, "next") && hasField(c, "random");
    }

    static boolean hasField(Class<?> c, String n) {
        try { c.getDeclaredField(n); return true; } catch (NoSuchFieldException e) { return false; }
    }

    static boolean isListNode(Class<?> c) {
        return fieldOf(c, "val") != null && fieldOf(c, "next") != null;
    }

    static Object newNode(Class<?> c) {
        try {
            Constructor<?> k = c.getDeclaredConstructor();
            k.setAccessible(true);
            return k.newInstance();
        } catch (NoSuchMethodException e) {
            try {
                Constructor<?> k = c.getDeclaredConstructor(int.class);
                k.setAccessible(true);
                return k.newInstance(Integer.valueOf(0));
            } catch (Exception e2) {
                throw new Fatal("无法创建 " + c.getSimpleName() + " 结点：它既没有无参构造函数，也没有 (int) 构造函数。");
            }
        } catch (Exception e) {
            throw new Fatal("无法创建 " + c.getSimpleName() + " 结点：" + e);
        }
    }

    static void setVal(Field f, Object node, Object v) {
        try {
            Class<?> t = f.getType();
            if (t == int.class) {
                f.setInt(node, (int) num(v, "结点的 val"));
            } else if (t == long.class) {
                f.setLong(node, (long) num(v, "结点的 val"));
            } else if (t == double.class) {
                f.setDouble(node, num(v, "结点的 val"));
            } else {
                f.set(node, coerce(v, t, t, "结点的 val"));
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("写入结点的 val 失败：" + e);
        }
    }

    /** 建链表并把尾巴接回下标 pos（pos < 0 表示无环）。顺带记下所有结点，供换算下标用。 */
    /** 在已建好的树里按值找结点（用 val 字段比，题目保证值互不相同） */
    static Object findTreeNode(Object root, Object val) {
        if (root == null) return null;
        Field fv = fieldOf(root.getClass(), "val");
        Field fl = fieldOf(root.getClass(), "left");
        Field fr = fieldOf(root.getClass(), "right");
        Deque<Object> st = new ArrayDeque<Object>();
        st.push(root);
        try {
            while (!st.isEmpty()) {
                Object n = st.pop();
                if (n == null) continue;
                Object nv = fv.get(n);
                if (nv != null && String.valueOf(nv).equals(String.valueOf(numOrSelf(val)))) return n;
                Object r = fr.get(n); if (r != null) st.push(r);
                Object l = fl.get(n); if (l != null) st.push(l);
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("在树里找结点失败：" + e);
        }
        return null;
    }

    static Object numOrSelf(Object v) {
        if (v instanceof Number) return Long.valueOf(((Number) v).longValue());
        return v;
    }

    /** 取结点的 val（node-value-output 用） */
    static Object nodeVal(Object node) {
        if (node == null) return null;
        try { return fieldOf(node.getClass(), "val").get(node); }
        catch (IllegalAccessException e) { throw new Fatal("读结点的 val 失败：" + e); }
    }

    static int nodeIndexOf(Object node) {
        for (int i = 0; i < LAST_NODES.size(); i++) {
            if (LAST_NODES.get(i) == node) return i;   // 身份比较，不是 equals
        }
        return -1;
    }

    static Object buildRandomList(Class<?> c, List<Object> pairs) {
        Field fv = fieldOf(c, "val");
        Field fn = fieldOf(c, "next");
        Field fr = fieldOf(c, "random");
        List<Object> nodes = new ArrayList<Object>();
        try {
            for (Object o : pairs) {
                List<Object> pr = asList(o, "随机链表的一项");
                Object n = newNode(c);
                setVal(fv, n, pr.isEmpty() ? null : pr.get(0));
                if (!nodes.isEmpty()) fn.set(nodes.get(nodes.size() - 1), n);
                nodes.add(n);
            }
            for (int i = 0; i < pairs.size(); i++) {
                List<Object> pr = asList(pairs.get(i), "随机链表的一项");
                Object r = pr.size() > 1 ? pr.get(1) : null;
                if (r != null) fr.set(nodes.get(i), nodes.get((int) num(r, "random 下标")));
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("构造随机链表失败：" + e);
        }
        LAST_NODES = nodes;
        return nodes.isEmpty() ? null : nodes.get(0);
    }

    /** 序列化成 [[val, randomIdx], …]；random 指到这条链之外（复用了原结点）记 -2 */
    static List<Object> randomListToPairs(Object head) {
        List<Object> out = new ArrayList<Object>();
        if (head == null) return out;
        Field fv = fieldOf(head.getClass(), "val");
        Field fn = fieldOf(head.getClass(), "next");
        Field fr = fieldOf(head.getClass(), "random");
        try {
            List<Object> ns = new ArrayList<Object>();
            for (Object p = head; p != null; p = fn.get(p)) {
                ns.add(p);
                if (ns.size() > 100000) throw new Fatal("随机链表上出现了环，走不到头");
            }
            for (Object n : ns) {
                List<Object> pair = new ArrayList<Object>();
                pair.add(fv.get(n));
                Object r = fr.get(n);
                if (r == null) {
                    pair.add(null);
                } else {
                    int at = -2;                       // -2 = 指到这条链之外
                    for (int i = 0; i < ns.size(); i++) if (ns.get(i) == r) { at = i; break; }
                    pair.add(Long.valueOf(at));
                }
                out.add(pair);
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("读随机链表失败：" + e);
        }
        return out;
    }

    static void joinTail(Class<?> c, List<Object> nodes, List<Object> other, int at) {
        if (at < 0 || nodes.isEmpty()) return;
        if (at >= other.size()) throw new Fatal("__joinTo 下标 " + at + " 超出另一条链的长度 " + other.size());
        try { fieldOf(c, "next").set(nodes.get(nodes.size() - 1), other.get(at)); }
        catch (IllegalAccessException e) { throw new Fatal("接尾巴失败：" + e); }
    }

    static Object buildListWithCycle(Class<?> c, List<Object> vals, int pos) {
        Field fv = fieldOf(c, "val");
        Field fn = fieldOf(c, "next");
        List<Object> nodes = new ArrayList<Object>();
        try {
            for (Object v : vals) {
                Object n = newNode(c);
                setVal(fv, n, v);
                if (!nodes.isEmpty()) fn.set(nodes.get(nodes.size() - 1), n);
                nodes.add(n);
            }
            if (pos >= 0 && !nodes.isEmpty()) {
                if (pos >= nodes.size()) {
                    throw new Fatal("cycle 下标 " + pos + " 超出链表长度 " + nodes.size());
                }
                fn.set(nodes.get(nodes.size() - 1), nodes.get(pos));
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("构造链表失败：" + e);
        }
        LAST_NODES = nodes;
        return nodes.isEmpty() ? null : nodes.get(0);
    }

    static Object buildList(Class<?> c, List<Object> vals) {
        Field fv = fieldOf(c, "val");
        Field fn = fieldOf(c, "next");
        Object head = null;
        Object tail = null;
        try {
            for (Object v : vals) {
                Object n = newNode(c);
                setVal(fv, n, v);
                if (head == null) {
                    head = n;
                } else {
                    fn.set(tail, n);
                }
                tail = n;
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("构造链表失败：" + e);
        }
        return head;
    }

    /** 与 Python 侧 array_to_tree 完全同构：层序、null 表示空位 */
    static Object buildTree(Class<?> c, List<Object> arr) {
        if (arr.isEmpty() || arr.get(0) == null) {
            LAST_TREE = null;
            return null;
        }
        Field fv = fieldOf(c, "val");
        Field fl = fieldOf(c, "left");
        Field fr = fieldOf(c, "right");
        try {
            Object root = newNode(c);
            setVal(fv, root, arr.get(0));
            Deque<Object> q = new ArrayDeque<Object>();
            q.add(root);
            int i = 1;
            while (!q.isEmpty() && i < arr.size()) {
                Object node = q.poll();
                if (i < arr.size() && arr.get(i) != null) {
                    Object l = newNode(c);
                    setVal(fv, l, arr.get(i));
                    fl.set(node, l);
                    q.add(l);
                }
                i++;
                if (i < arr.size() && arr.get(i) != null) {
                    Object r = newNode(c);
                    setVal(fv, r, arr.get(i));
                    fr.set(node, r);
                    q.add(r);
                }
                i++;
            }
            return root;
        } catch (IllegalAccessException e) {
            throw new Fatal("构造二叉树失败：" + e);
        }
    }

    /* ---------------- 返回值 -> JSON 值 ---------------- */

    /**
     * 空链表 / 空树在 Java 里是 null，在 Python 侧却是 []。
     * 光看值分不出来（null 没有形状），所以看【声明的类型】：返回类型是结点类就按空数组算。
     * 这样依然不需要给每道题预配 ioType —— 反射拿得到返回类型。
     */
    static Object toJsonTyped(Object v, Class<?> declared) {
        if (v == null && declared != null && !declared.isPrimitive()
            && (isTreeNode(declared) || isListNode(declared))) {
            return new ArrayList<Object>();
        }
        return toJson(v);
    }

    static Object toJson(Object o) {
        if (o == null) {
            return null;
        }
        if (o instanceof Boolean || o instanceof String || o instanceof Number) {
            return o;
        }
        if (o instanceof Character) {
            return String.valueOf(o);
        }
        if (o.getClass().isArray()) {
            int n = Array.getLength(o);
            List<Object> out = new ArrayList<Object>(n);
            for (int i = 0; i < n; i++) {
                out.add(toJson(Array.get(o, i)));
            }
            return out;
        }
        if (o instanceof Collection) {
            List<Object> out = new ArrayList<Object>();
            for (Object e : (Collection<?>) o) {
                out.add(toJson(e));
            }
            return out;
        }
        if (o instanceof Map) {
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                out.put(String.valueOf(e.getKey()), toJson(e.getValue()));
            }
            return out;
        }
        Class<?> c = o.getClass();
        if (isTreeNode(c)) {
            return treeToArray(o, c);
        }
        if (isListNode(c)) {
            return listToArray(o, c);
        }
        return String.valueOf(o);
    }

    static List<Object> listToArray(Object head, Class<?> c) {
        Field fv = fieldOf(c, "val");
        Field fn = fieldOf(c, "next");
        List<Object> out = new ArrayList<Object>();
        Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<Object, Boolean>());
        Object cur = head;
        try {
            while (cur != null) {
                if (!seen.add(cur)) {
                    throw new Fatal("你返回的链表里有环（next 指针接回了前面的结点），没法转成数组来比较。");
                }
                out.add(toJson(fv.get(cur)));
                cur = fn.get(cur);
                if (out.size() > 100000) {
                    throw new Fatal("你返回的链表超过 10 万个结点，判题已中止。");
                }
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("读取链表失败：" + e);
        }
        return out;
    }

    /** 与 Python 侧 tree_to_array 完全同构：层序展开、补 null、去掉末尾多余的 null */
    static List<Object> treeToArray(Object root, Class<?> c) {
        List<Object> out = new ArrayList<Object>();
        if (root == null) {
            return out;
        }
        Field fv = fieldOf(c, "val");
        Field fl = fieldOf(c, "left");
        Field fr = fieldOf(c, "right");
        Deque<Object> q = new ArrayDeque<Object>();
        q.add(root);
        try {
            while (!q.isEmpty()) {
                Object n = q.poll();
                if (n == HOLE) {
                    out.add(null);
                    continue;
                }
                out.add(toJson(fv.get(n)));
                Object l = fl.get(n);
                Object r = fr.get(n);
                q.add(l == null ? HOLE : l);
                q.add(r == null ? HOLE : r);
                if (out.size() > 200000) {
                    throw new Fatal("你返回的二叉树太大（可能有环），判题已中止。");
                }
            }
        } catch (IllegalAccessException e) {
            throw new Fatal("读取二叉树失败：" + e);
        }
        while (!out.isEmpty() && out.get(out.size() - 1) == null) {
            out.remove(out.size() - 1);
        }
        return out;
    }

    /* ---------------- 比较 ---------------- */

    static Object norm(Object v) {
        if (v == null) {
            return null;
        }
        if (v instanceof Number) {
            // 1 与 1.0 在 Python 里相等，这里统一成 double，避免 Integer/Long/Double 之间比不等
            return Double.valueOf(((Number) v).doubleValue());
        }
        if (v instanceof Boolean || v instanceof String) {
            return v;
        }
        if (v instanceof List) {
            List<Object> out = new ArrayList<Object>();
            for (Object e : (List<?>) v) {
                out.add(norm(e));
            }
            return out;
        }
        if (v instanceof Map) {
            Map<String, Object> out = new LinkedHashMap<String, Object>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                out.put(String.valueOf(e.getKey()), norm(e.getValue()));
            }
            return out;
        }
        return String.valueOf(v);
    }

    /**
     * 排序键用序列化后的字符串。注意：只要两边用的是【同一个全序】，
     * "各自排序后逐项相等" 就等价于 "多重集合相等"，所以不需要复刻 Python 的排序规则。
     */
    static String keyOf(Object v) {
        return Json.write(v);
    }

    @SuppressWarnings("unchecked")
    static Object sortedOf(Object v) {
        if (!(v instanceof List)) {
            return v;
        }
        List<Object> l = new ArrayList<Object>((List<Object>) v);
        l.sort(Comparator.comparing(Hot100Judge::keyOf));
        return l;
    }

    @SuppressWarnings("unchecked")
    static Object sortedInnerThenOuter(Object v) {
        if (!(v instanceof List)) {
            return v;
        }
        List<Object> l = new ArrayList<Object>();
        for (Object g : (List<Object>) v) {
            l.add(sortedOf(g));
        }
        l.sort(Comparator.comparing(Hot100Judge::keyOf));
        return l;
    }

    /* 下面两个直接在层序数组上算，不建结点对象 —— 判题只需要结论，不需要树。
       层序数组里 null 表示空位；孩子下标不是 2i+1/2i+2（那是满二叉树的算法），
       要按"跳过 null"的方式一层层配对，和 buildTree 的规则保持一致。 */
    static List<Object> inorderOfLevel(List<Object> arr) {
        Map<Integer, Integer> lc = new LinkedHashMap<Integer, Integer>();
        Map<Integer, Integer> rc = new LinkedHashMap<Integer, Integer>();
        linkLevel(arr, lc, rc);
        List<Object> out = new ArrayList<Object>();
        inorderGo(arr, lc, rc, arr.isEmpty() || arr.get(0) == null ? -1 : 0, out);
        return out;
    }

    static void linkLevel(List<Object> arr, Map<Integer, Integer> lc, Map<Integer, Integer> rc) {
        if (arr.isEmpty() || arr.get(0) == null) return;
        Deque<Integer> q = new ArrayDeque<Integer>();
        q.add(Integer.valueOf(0));
        int i = 1;
        while (!q.isEmpty() && i < arr.size()) {
            int cur = q.poll().intValue();
            if (i < arr.size()) {
                if (arr.get(i) != null) { lc.put(Integer.valueOf(cur), Integer.valueOf(i)); q.add(Integer.valueOf(i)); }
                i++;
            }
            if (i < arr.size()) {
                if (arr.get(i) != null) { rc.put(Integer.valueOf(cur), Integer.valueOf(i)); q.add(Integer.valueOf(i)); }
                i++;
            }
        }
    }

    static void inorderGo(List<Object> arr, Map<Integer, Integer> lc, Map<Integer, Integer> rc, int i, List<Object> out) {
        if (i < 0) return;
        Integer l = lc.get(Integer.valueOf(i));
        Integer r = rc.get(Integer.valueOf(i));
        if (l != null) inorderGo(arr, lc, rc, l.intValue(), out);
        out.add(arr.get(i));
        if (r != null) inorderGo(arr, lc, rc, r.intValue(), out);
    }

    static boolean heightOk(List<Object> arr) {
        Map<Integer, Integer> lc = new LinkedHashMap<Integer, Integer>();
        Map<Integer, Integer> rc = new LinkedHashMap<Integer, Integer>();
        linkLevel(arr, lc, rc);
        boolean[] ok = { true };
        heightGo(lc, rc, arr.isEmpty() || arr.get(0) == null ? -1 : 0, ok);
        return ok[0];
    }

    static int heightGo(Map<Integer, Integer> lc, Map<Integer, Integer> rc, int i, boolean[] ok) {
        if (i < 0) return 0;
        Integer l = lc.get(Integer.valueOf(i));
        Integer r = rc.get(Integer.valueOf(i));
        int a = heightGo(lc, rc, l == null ? -1 : l.intValue(), ok);
        int b = heightGo(lc, rc, r == null ? -1 : r.intValue(), ok);
        if (Math.abs(a - b) > 1) ok[0] = false;
        return 1 + Math.max(a, b);
    }

    static boolean compare(Object actual, Object expected, String mode) {
        Object a = norm(actual);
        Object e = norm(expected);
        if ("balanced_bst".equals(mode)) {
            /* 「有序数组转二叉搜索树」的答案**不唯一**：mid 取 (lo+hi)/2 还是 (lo+hi+1)/2
               会得到两棵都合法的平衡 BST。拿参考解那棵去 exact 比，等于把另一种正确写法判错。
               判据换成题目真正要求的两条：装的是同一批数且中序有序、而且高度平衡。 */
            try {
                List<Object> ia = inorderOfLevel(asList(a, "实际结果"));
                List<Object> ie = inorderOfLevel(asList(e, "期望结果"));
                return Objects.equals(String.valueOf(ia), String.valueOf(ie))
                    && heightOk(asList(a, "实际结果"));
            } catch (Throwable t) {
                return false;
            }
        }
        if ("unordered".equals(mode)) {
            a = sortedOf(a);
            e = sortedOf(e);
        } else if ("set_of_sets".equals(mode)) {
            a = sortedInnerThenOuter(a);
            e = sortedInnerThenOuter(e);
        }
        return Objects.equals(a, e);
    }

    /** 只保留学生自己的栈帧，反射与判题外壳的帧全部滤掉，报错才看得懂 */
    static String stackOf(Throwable t) {
        if (t == null) {
            return "未知错误";
        }
        StringBuilder sb = new StringBuilder();
        sb.append(t.toString());
        for (StackTraceElement el : t.getStackTrace()) {
            String cn = el.getClassName();
            if (cn.startsWith("Hot100Judge") || cn.startsWith("java.") || cn.startsWith("jdk.") || cn.startsWith("sun.")) {
                continue;
            }
            sb.append(NL).append("    at ").append(el);
        }
        Throwable cause = t.getCause();
        if (cause != null && cause != t) {
            sb.append(NL).append("Caused by: ").append(cause);
        }
        return sb.toString();
    }

    /* ---------------- 迷你 JSON（不引第三方库） ---------------- */

    static final class Json {
        private final String s;
        private int i;

        private Json(String src) {
            this.s = src;
        }

        static Object parse(String src) {
            Json p = new Json(src);
            p.ws();
            Object v = p.value();
            p.ws();
            if (p.i < src.length()) {
                throw new Fatal("用例数据不是合法 JSON（第 " + p.i + " 个字符后仍有内容）");
            }
            return v;
        }

        private void ws() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) {
                i++;
            }
        }

        private void expect(String lit) {
            if (!s.startsWith(lit, i)) {
                throw new Fatal("用例数据不是合法 JSON（位置 " + i + "）");
            }
            i += lit.length();
        }

        private Object value() {
            if (i >= s.length()) {
                throw new Fatal("用例数据意外结束");
            }
            char c = s.charAt(i);
            if (c == '{') {
                return obj();
            }
            if (c == '[') {
                return arr();
            }
            if (c == '"') {
                return string();
            }
            if (c == 't') {
                expect("true");
                return Boolean.TRUE;
            }
            if (c == 'f') {
                expect("false");
                return Boolean.FALSE;
            }
            if (c == 'n') {
                expect("null");
                return null;
            }
            return number();
        }

        private Map<String, Object> obj() {
            Map<String, Object> m = new LinkedHashMap<String, Object>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == '}') {
                i++;
                return m;
            }
            while (true) {
                ws();
                String k = string();
                ws();
                expect(":");
                ws();
                m.put(k, value());
                ws();
                if (i >= s.length()) {
                    throw new Fatal("JSON 对象没有闭合");
                }
                char c = s.charAt(i++);
                if (c == '}') {
                    return m;
                }
                if (c != ',') {
                    throw new Fatal("JSON 对象格式错误（位置 " + (i - 1) + "）");
                }
            }
        }

        private List<Object> arr() {
            List<Object> l = new ArrayList<Object>();
            i++;
            ws();
            if (i < s.length() && s.charAt(i) == ']') {
                i++;
                return l;
            }
            while (true) {
                ws();
                l.add(value());
                ws();
                if (i >= s.length()) {
                    throw new Fatal("JSON 数组没有闭合");
                }
                char c = s.charAt(i++);
                if (c == ']') {
                    return l;
                }
                if (c != ',') {
                    throw new Fatal("JSON 数组格式错误（位置 " + (i - 1) + "）");
                }
            }
        }

        private String string() {
            if (i >= s.length() || s.charAt(i) != '"') {
                throw new Fatal("这里应该是一个 JSON 字符串（位置 " + i + "）");
            }
            i++;
            StringBuilder sb = new StringBuilder();
            while (i < s.length()) {
                char c = s.charAt(i++);
                if (c == '"') {
                    return sb.toString();
                }
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                char e = s.charAt(i++);
                if (e == 'n') {
                    sb.append('\n');
                } else if (e == 't') {
                    sb.append('\t');
                } else if (e == 'r') {
                    sb.append('\r');
                } else if (e == 'b') {
                    sb.append('\b');
                } else if (e == 'f') {
                    sb.append('\f');
                } else if (e == 'u') {
                    sb.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    i += 4;
                } else {
                    sb.append(e);
                }
            }
            throw new Fatal("JSON 字符串没有闭合");
        }

        private Object number() {
            int start = i;
            while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) {
                i++;
            }
            String t = s.substring(start, i);
            if (t.isEmpty()) {
                throw new Fatal("用例数据不是合法 JSON（位置 " + start + "）");
            }
            if (t.indexOf('.') >= 0 || t.indexOf('e') >= 0 || t.indexOf('E') >= 0) {
                return Double.valueOf(t);
            }
            return Long.valueOf(t);
        }

        static String write(Object v) {
            StringBuilder sb = new StringBuilder();
            w(v, sb);
            return sb.toString();
        }

        private static void w(Object v, StringBuilder sb) {
            if (v == null) {
                sb.append("null");
                return;
            }
            if (v instanceof String) {
                wstr((String) v, sb);
                return;
            }
            if (v instanceof Character) {
                wstr(String.valueOf(v), sb);
                return;
            }
            if (v instanceof Boolean) {
                sb.append(v.toString());
                return;
            }
            if (v instanceof Double || v instanceof Float) {
                double d = ((Number) v).doubleValue();
                if (Double.isNaN(d) || Double.isInfinite(d)) {
                    wstr(String.valueOf(d), sb);   // inf / nan 不是合法 JSON，转成字符串免得前端 JSON.parse 整条炸掉
                    return;
                }
                if (d == Math.rint(d) && Math.abs(d) < 1e15) {
                    sb.append((long) d);           // 1.0 输出成 1，与 Python 的整数输出对齐
                    return;
                }
                sb.append(d);
                return;
            }
            if (v instanceof Number) {
                sb.append(v.toString());
                return;
            }
            if (v instanceof Collection) {
                sb.append('[');
                boolean first = true;
                for (Object e : (Collection<?>) v) {
                    if (!first) {
                        sb.append(',');
                    }
                    first = false;
                    w(e, sb);
                }
                sb.append(']');
                return;
            }
            if (v instanceof Map) {
                sb.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
                    if (!first) {
                        sb.append(',');
                    }
                    first = false;
                    wstr(String.valueOf(e.getKey()), sb);
                    sb.append(':');
                    w(e.getValue(), sb);
                }
                sb.append('}');
                return;
            }
            if (v.getClass().isArray()) {
                sb.append('[');
                int n = Array.getLength(v);
                for (int k = 0; k < n; k++) {
                    if (k > 0) {
                        sb.append(',');
                    }
                    w(Array.get(v, k), sb);
                }
                sb.append(']');
                return;
            }
            wstr(String.valueOf(v), sb);
        }

        private static void wstr(String s, StringBuilder sb) {
            sb.append('"');
            for (int k = 0; k < s.length(); k++) {
                char c = s.charAt(k);
                if (c == '"') {
                    sb.append("\\\"");
                } else if (c == '\\') {
                    sb.append("\\\\");
                } else if (c == '\n') {
                    sb.append("\\n");
                } else if (c == '\r') {
                    sb.append("\\r");
                } else if (c == '\t') {
                    sb.append("\\t");
                } else if (c < 0x20) {
                    sb.append(String.format("\\u%04x", Integer.valueOf(c)));
                } else {
                    sb.append(c);
                }
            }
            sb.append('"');
        }
    }
}
