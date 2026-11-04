// 迁移助手用：以官方运行时自己的 initProfile 初始化 desktop profile。
// 与官方桌面端首启时的 createPluginProfile 是同一个调用（initProfile(dir, WEB_PROFILE.bundles)），
// 已存在的文件一概不碰，所以重复运行无害。这样装插件前不必先打开、再强行关掉官方端。
// 用法（ELECTRON_RUN_AS_NODE=1）："<官方安装目录>\DeepSeek Harness.exe" init-desktop-profile.mjs <官方安装目录> <DSH_HOME>
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [install, home] = process.argv.slice(2)
const load = pkg => import(pathToFileURL(join(install, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', pkg, 'lib', 'index.js')).href)
const boot = await load('dsh-app-boot')
// 官方 0.2.2 起模板搬到 dsh-official-bundles，app-boot 不再导出；更新源给哪版就要能跑哪版。
const templates = boot.PROFILE_TEMPLATES ?? (await load('dsh-official-bundles')).PROFILE_TEMPLATES
const dir = join(home, 'profiles', 'desktop')
boot.initProfile(dir, templates.web.bundles)
console.log(dir)
