import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import javaRunner from './server/java-runner.mjs'
import envApi from './server/env-api.mjs'
import snapshotApi from './server/snapshot-api.mjs'
import baguApi from './server/bagu-api.mjs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
// 打包日期只精确到天：够用来问「你用的是哪天的包」，又不会让同一天的两次构建产物不一致
const buildDate = new Date().toISOString().slice(0, 10)

// https://vite.dev/config/
export default defineConfig({
  // javaRunner 同时挂在 dev 与 preview 上：用本机 JDK 编译/运行 Java，只走本地，不联网。
  // envApi 只回本地服务的 Node 版本与平台，供「复制诊断信息」使用。
  // snapshotApi 把「自动快照」存到浏览器之外的普通文件里 ——
  //   2026-08-25 出过一次 localStorage 被清空（IndexedDB 却完好），而当时从未手动备份过。
  //   规则见 server/snapshot-store.mjs，核心是"空的不写、重复的不写、最完整的一份不删"。
  // baguApi 读八股文板块的「原文」—— 原文在仓库外、运行时读，所以不会进 dist 和安装包，
  //   别人的机器上没有就不显示那一栏。原因见 server/bagu-api.mjs 顶部。
  plugins: [react(), javaRunner(), envApi(), snapshotApi(), baguApi()],
  // 版本号在构建时文本替换进代码（见 src/appInfo.js）。
  // 发给别人之后，「你用的哪一版」是排查任何问题的第一句话。
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  // dev 与 preview 都锁在 5178：同源才共用同一份 localStorage，
  // 否则开发模式(5173)和快捷方式启动的预览(5178)会是两套互不相干的进度。
  //
  // ⚠ 端口**绝对不能自动漂移**（比如"被占用就换一个"）：
  // 浏览器按源隔离存储，实测配图目录名就叫 http_localhost_5178.indexeddb.leveldb ——
  // 端口一变就是另一个源，代码/笔记/进度/配图会全部读不出来，
  // 在用户那里表现为"我昨天写的东西全没了"。要换端口只能是人为改配置并且自己知道。
  server: { port: 5178, strictPort: true },
  preview: { port: 5178, strictPort: true },
  // 两个页面：index.html 是程序本身；migrate.html 只给 Electron 外壳第一次启动时，
  // 让后台的旧浏览器读出旧版数据用（见 src/migrate.js、electron/migrate.mjs）
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        migrate: fileURLToPath(new URL('./migrate.html', import.meta.url)),
      },
    },
  },
})
