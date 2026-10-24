// 迁移助手用：把 DeepSeekGUI 的 DSH 数据合并进官方桌面端的 DSH 目录（目标为空时就等于复制）。
// 由官方桌面端程序以 Node 模式运行（ELECTRON_RUN_AS_NODE=1），YAML 用官方运行时自带的 yaml 库，
// 与官方 dsh-credentials-local 读写凭据文件用的是同一个库。
// 用法："<官方安装目录>\DeepSeek Harness.exe" merge-data.mjs <官方安装目录> <GUI 的 DSH 目录> <官方的 DSH 目录> <结果 JSON 路径>
//
// 规则：官方那边已有的东西一律不改，只补它没有的。
//   - 会话、会话显示缓存、附件、deepseekgui/、模型列表缓存：只补缺的文件（会话 id 是 UUID，不会撞）
//   - storages/workspace.json：同一路径的工作区合并会话列表；新路径的工作区加进去；默认工作区保留官方的
//   - .credentials.yaml：只补官方没有的键（官方已有 API 密钥就保留官方的）
//   - memory.md / AGENTS.md：两边都有且不同时，把 GUI 的内容接在后面并注明来源
// 结果写成 JSON 文件，由 migrate.ps1 读回。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [install, src, dst, reportPath] = process.argv.slice(2)
const YAML = await import(pathToFileURL(join(install, 'resources', 'app.asar', 'dsh', 'node_modules', 'yaml', 'dist', 'index.js')).href)
const report = { sessionsAdded: 0, workspacesAdded: 0, workspacesMerged: 0, credentialsAdded: [], credentialsKept: [], notes: [], copied: [] }

/** 改官方已有文件之前，原件先备份一份到 deepseekgui/migration-backup/（同名的旧备份不覆盖）。 */
function backup(path, rel) {
  const to = join(dst, 'deepseekgui', 'migration-backup', rel)
  if (existsSync(to)) return
  mkdirSync(join(to, '..'), { recursive: true })
  cpSync(path, to)
}
/** 原子写：先写临时文件再改名，崩在中间不会留下半个 JSON / YAML。改之前先备份原件。 */
function writeAtomic(path, text) {
  backup(path, path.slice(dst.length).replace(/^[\\/]+/, ''))
  const tmp = `${path}.migrate-${process.pid}.tmp`; writeFileSync(tmp, text); renameSync(tmp, path)
}
/** 某个会话目录下有哪些会话（sessions/<工作区>/<会话>）。 */
function sessionDirs(home) {
  const root = join(home, 'sessions'); const out = new Set()
  if (!existsSync(root)) return out
  for (const ws of readdirSync(root)) for (const s of readdirSync(join(root, ws))) out.add(`${ws}/${s}`)
  return out
}
/** 只补缺的：cpSync 不覆盖已有文件，目录逐层合并。 */
function addMissing(rel) {
  const s = join(src, rel)
  if (!existsSync(s)) return
  cpSync(s, join(dst, rel), { recursive: true, force: false, errorOnExist: false })
  report.copied.push(rel)
}

mkdirSync(dst, { recursive: true })
const before = sessionDirs(dst)
for (const rel of ['sessions', join('storages', 'session_projcache'), 'attachments', 'deepseekgui', 'llm-deepseek', '.anonymous-user-id']) addMissing(rel)
for (const s of sessionDirs(dst)) if (!before.has(s)) report.sessionsAdded++

// 工作区列表
const wsRel = join('storages', 'workspace.json')
if (existsSync(join(src, wsRel))) {
  if (!existsSync(join(dst, wsRel))) addMissing(wsRel)
  else {
    const S = JSON.parse(readFileSync(join(src, wsRel), 'utf8')); const T = JSON.parse(readFileSync(join(dst, wsRel), 'utf8'))
    if (S.unit?.name !== 'workspace' || T.unit?.name !== 'workspace' || S.unit.version !== T.unit.version) {
      report.notes.push('workspace-version-mismatch')
    } else {
      const norm = (p) => String(p).replace(/[\\/]+$/, '').toLowerCase()
      for (const [id, ws] of Object.entries(S.tables.workspaces)) {
        const hit = Object.values(T.tables.workspaces).find((w) => norm(w.path) === norm(ws.path))
        if (hit) {
          for (const sid of ws.sessionIds ?? []) if (!hit.sessionIds.includes(sid)) hit.sessionIds.push(sid)
          report.workspacesMerged++
        } else {
          const nid = T.tables.workspaces[id] ? randomUUID() : id
          T.tables.workspaces[nid] = ws
          T.global.workspaceIds.push(nid)
          report.workspacesAdded++
        }
      }
      for (const key of ['archivedSessionIds', 'pinnedSessionIds']) {
        for (const sid of S.global[key] ?? []) if (!(T.global[key] ?? []).includes(sid)) (T.global[key] ??= []).push(sid)
      }
      writeAtomic(join(dst, wsRel), JSON.stringify(T, null, 2) + '\n')
    }
  }
}

// 凭据：只补官方没有的键
const credRel = '.credentials.yaml'
if (existsSync(join(src, credRel))) {
  if (!existsSync(join(dst, credRel))) { addMissing(credRel); report.credentialsAdded.push('*') }
  else {
    const S = YAML.parse(readFileSync(join(src, credRel), 'utf8')) ?? {}
    const doc = YAML.parseDocument(readFileSync(join(dst, credRel), 'utf8'))
    for (const section of ['refs', 'records']) {
      for (const key of Object.keys(S[section] ?? {})) {
        if (doc.hasIn([section, key])) report.credentialsKept.push(key)
        else { doc.setIn([section, key], S[section][key]); report.credentialsAdded.push(key) }
      }
    }
    if (report.credentialsAdded.length) writeAtomic(join(dst, credRel), doc.toString())
  }
}

// 全局记忆与规则：都有且不同就接在后面
for (const name of ['memory.md', 'AGENTS.md']) {
  const s = join(src, name); const d = join(dst, name)
  if (!existsSync(s)) continue
  if (!existsSync(d)) { addMissing(name); continue }
  const a = readFileSync(d, 'utf8'); const b = readFileSync(s, 'utf8')
  if (a.trim() === b.trim() || a.includes(b.trim())) continue
  writeAtomic(d, `${a.replace(/\s*$/, '')}\n\n<!-- 以下来自 DeepSeekGUI（迁移时合并） -->\n\n${b}`)
  report.notes.push(`appended-${name}`)
}

// 结果写文件：官方端 exe 是窗口程序，PowerShell 收不到它的标准输出
writeFileSync(reportPath, JSON.stringify(report))
