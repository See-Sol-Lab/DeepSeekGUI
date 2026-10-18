/**
 * 程序与托管数据整体搬家（Phase 1，2026-10-05）的纯逻辑部分：布局、目标判定、
 * 搬家记录与安装器参数。执行面见 relocation-control.ts。
 *
 * 布局：用户选一个父目录 P，搬完后
 *   P/DeepSeekGUI/app  ← 程序本体（NSIS 的 $INSTDIR）
 *   P/DeepSeekGUI/dsh  ← Managed Home（现有数据迁移的「<目标>/dsh」约定）
 * 程序与数据是兄弟目录：卸载、更新只碰 app，绝不会顺手带走 dsh。
 *
 * 程序本体不由我们自己拷：运行中的 exe 不能安全自搬，卸载注册、快捷方式和
 * 下一次更新的落点也都是安装器的事实。做法是用**同一版本**的已校验安装包
 * 静默安装到新目录（`/S /D=<app>`）。electron-builder 的按用户安装认 `/D=`；
 * 安装器先跑旧卸载器（`--updated`，不碰数据）再把注册表的 InstallLocation、
 * 卸载入口与快捷方式写成新位置——以后每次更新都从注册表读这个位置，所以不会
 * 装回 C 盘。
 *
 * 交接由一个**短生命周期助手**（系统自带的 powershell.exe 跑下面的脚本，它不在
 * 会被卸载的程序目录里）完成，Sol 审查 P1-01/P1-02 后改的：
 *   等应用主进程退出、且旧程序目录里不再有任何进程 → 再核一次安装包摘要 →
 *   运行安装器 → 新位置真有 exe 才从新位置打开；
 *   没装成：旧程序还在就打开旧的；旧程序已被卸掉就用同一个安装包装回原位置；
 *   连这一步也失败就弹框写明安装包和数据在哪、怎么手动恢复。
 * 安装包副本与助手状态一直留到新位置启动核对通过（或用户放弃）为止。
 *
 * 纯 Node 模块，不依赖 Electron，便于单元测试。
 * @module @see-sol-lab/deepseekgui/relocation
 */

import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { atomicWriteFile } from './atomic-write.ts'

const execFileAsync = promisify(execFile)

/** 搬家根目录名：P 之下固定这一层，避免把程序和数据直接撒在用户选的目录里。 */
export const RELOCATION_ROOT_NAME = 'DeepSeekGUI'
/** 程序本体子目录名。 */
export const RELOCATION_APP_NAME = 'app'
/** Managed Home 子目录名：与现有数据迁移的 `<目标父目录>/dsh` 约定一致。 */
export const RELOCATION_HOME_NAME = 'dsh'
/**
 * 安装目录长度上限：与 build/installer.nsh 的 DEEPSEEKGUI_MAX_INSTDIR_LEN 同一个数
 * （打包脚本按产物里最长相对路径实测，超出则部分文件写不进去、卸载与升级随后失败）。
 * 安装器自己也会拦，但静默安装被拦时用户什么都看不见，所以在这里先判。
 */
export const MAX_INSTALL_DIR_LENGTH = 85
/** 搬家记录文件名（在 Electron userData 下，与 launcher-state.json 同处）。 */
export const RELOCATION_RECORD_FILENAME = 'relocation.json'

/** 一次搬家计划里的三个位置。 */
export interface RelocationLayout {
  /** P/DeepSeekGUI。 */
  readonly root: string
  /** P/DeepSeekGUI/app：安装器的 /D 目标。 */
  readonly appDir: string
  /** P/DeepSeekGUI/dsh：Managed Home 的新位置。 */
  readonly home: string
}

/**
 * 由用户选的父目录得出布局。
 * @param parent - 用户选的父目录（已 realpath）。
 * @returns 三个绝对路径。
 */
export function relocationLayout(parent: string): RelocationLayout {
  const root = resolve(parent, RELOCATION_ROOT_NAME)
  return { root, appDir: join(root, RELOCATION_APP_NAME), home: join(root, RELOCATION_HOME_NAME) }
}

/**
 * 这个可执行文件是不是装在「搬家布局」里：exe 所在目录叫 app，上一层叫
 * DeepSeekGUI。是的话给出同一布局下的 Home 路径，否则 null。
 *
 * 首次启动用它决定新用户的数据放哪：安装时选了别的盘、装进了
 * `<P>/DeepSeekGUI/app`，数据就该在 `<P>/DeepSeekGUI/dsh`，而不是默认的
 * `%APPDATA%`。只看目录名、不看盘符：默认安装位置
 * `%LOCALAPPDATA%/Programs/DeepSeekGUI` 的 exe 直接在 DeepSeekGUI 下，不会命中。
 * @param execPath - process.execPath。
 * @returns 布局里的 Home，或 null。
 */
export function layoutHomeOf(execPath: string): string | null {
  const appDir = dirname(execPath)
  const root = dirname(appDir)
  if (basename(appDir).toLowerCase() !== RELOCATION_APP_NAME) return null
  if (basename(root).toLowerCase() !== RELOCATION_ROOT_NAME.toLowerCase()) return null
  return join(root, RELOCATION_HOME_NAME)
}

/** 归一化比较用路径：绝对、去尾分隔符；Windows 大小写不敏感。 */
function canonical(path: string, win: boolean): string {
  const value = resolve(path).replace(/[\\/]+$/u, '')
  return win ? value.toLowerCase() : value
}

/** inner 是否位于 outer 内部（或相等）。 */
function within(outer: string, inner: string, win: boolean): boolean {
  const base = canonical(outer, win)
  const candidate = canonical(inner, win)
  return candidate === base || candidate.startsWith(`${base}${win ? '\\' : sep}`)
}

/** 目标判定的拒绝理由（界面按键各自成文）。 */
export type RelocationRejection =
  | 'not-absolute'
  | 'too-long'
  | 'same-as-current'
  | 'inside-current-app'
  | 'current-app-inside-target'
  | 'inside-current-home'
  | 'current-home-inside-target'
  | 'protected-location'
  | 'inside-project'
  | 'root-is-link'
  | 'root-not-empty'
  | 'not-writable'
  | 'not-enough-space'

/** 目标判定需要的文件系统事实（注入以便测试）。 */
export interface RelocationFacts {
  exists(path: string): boolean
  /** 目录里的条目名（不存在为空数组）。 */
  names(path: string): string[]
  /** 是否是符号链接或 junction（不存在视为否）。 */
  isLink(path: string): boolean
  /** 可写（不存在时看最近的已存在祖先）。 */
  isWritable(path: string): boolean
  /** 所在卷的空闲字节数（不存在时看最近的已存在祖先）。 */
  freeBytes(path: string): number
}

/** 目标判定的输入。 */
export interface RelocationCheckInput {
  /** 用户选的父目录（已 realpath）。 */
  readonly parent: string
  /** 当前程序目录（dirname(process.execPath)）。 */
  readonly currentAppDir: string
  /** 当前 Home。 */
  readonly currentHome: string
  /** 当前 Home 是不是 Managed：Existing Home 不随程序搬，不参与包含判定。 */
  readonly homeIsManaged: boolean
  /** 需要的字节数（程序 + 要搬的数据）。 */
  readonly requiredBytes: number
  /**
   * 不允许落进去的系统位置（%SystemRoot%、Program Files、ProgramData 等）。
   * 由调用方按当前机器取值；Program Files 需要管理员权限，按用户安装落不进去。
   */
  readonly protectedRoots: readonly string[]
  /** 是否 Windows（路径大小写与分隔符规则）。 */
  readonly win: boolean
  readonly facts: RelocationFacts
}

/** 目标判定结果。 */
export type RelocationVerdict =
  | { readonly ok: true; readonly layout: RelocationLayout }
  | { readonly ok: false; readonly reason: RelocationRejection; readonly detail: string }

/**
 * 判定用户选的父目录能不能作为整体搬家的目标。
 *
 * 只做结构判断，不写任何东西。拒绝的情形都有自己的理由：同一位置、互相嵌套
 * （程序装进旧程序目录会被旧卸载器一起删掉；数据搬进自己里面复制不完）、系统
 * 目录、某个 Git 项目里面（GUI 源码或别人的项目）、根目录是链接、根目录已有
 * 东西、不可写、空间不够、路径太长。
 * @param input - 父目录、当前位置与文件系统事实。
 * @returns 判定；ok 时给出布局。
 */
export function checkRelocationTarget(input: RelocationCheckInput): RelocationVerdict {
  const { win, facts } = input
  if (!isAbsolute(input.parent)) return { ok: false, reason: 'not-absolute', detail: input.parent }
  const layout = relocationLayout(input.parent)
  if (layout.appDir.length > MAX_INSTALL_DIR_LENGTH) {
    return { ok: false, reason: 'too-long', detail: layout.appDir }
  }
  if (canonical(layout.appDir, win) === canonical(input.currentAppDir, win)) {
    return { ok: false, reason: 'same-as-current', detail: layout.appDir }
  }
  // 新程序目录在旧程序目录里：安装器随后用旧卸载器删旧目录，会把新装的一起删掉。
  if (within(input.currentAppDir, layout.root, win)) {
    return { ok: false, reason: 'inside-current-app', detail: layout.root }
  }
  if (within(layout.root, input.currentAppDir, win)) {
    return { ok: false, reason: 'current-app-inside-target', detail: layout.root }
  }
  if (input.homeIsManaged) {
    if (within(input.currentHome, layout.root, win)) {
      return { ok: false, reason: 'inside-current-home', detail: layout.root }
    }
    if (within(layout.root, input.currentHome, win)) {
      return { ok: false, reason: 'current-home-inside-target', detail: layout.root }
    }
  }
  for (const guarded of input.protectedRoots) {
    if (guarded !== '' && within(guarded, layout.root, win)) {
      return { ok: false, reason: 'protected-location', detail: guarded }
    }
  }
  // 某个 Git 项目里面：GUI 自己的源码仓库或用户的项目。程序和数据不该混进去。
  for (let dir = input.parent; ; dir = dirname(dir)) {
    if (facts.exists(join(dir, '.git'))) return { ok: false, reason: 'inside-project', detail: dir }
    if (dirname(dir) === dir) break
  }
  if (facts.exists(layout.root)) {
    if (facts.isLink(layout.root)) return { ok: false, reason: 'root-is-link', detail: layout.root }
    if (facts.names(layout.root).length > 0) return { ok: false, reason: 'root-not-empty', detail: layout.root }
  }
  const probe = facts.exists(layout.root) ? layout.root : input.parent
  if (!facts.isWritable(probe)) return { ok: false, reason: 'not-writable', detail: probe }
  if (facts.freeBytes(probe) < input.requiredBytes) return { ok: false, reason: 'not-enough-space', detail: probe }
  return { ok: true, layout }
}

/**
 * 重试时的目标判定（Sol P1-04）：允许继续自己的那个目标，但不盲信旧记录——
 * 根目录与程序目录不能变成链接；根目录里只能有我们自己的 `app` 与 `dsh`
 * （上一次没装成的半成品、已经搬过去的数据），出现别的东西就停；系统目录照拦；要可写。
 * @param input - 记录里的根与程序目录、系统位置与文件系统事实。
 * @returns 判定。
 */
export function checkRetryTarget(input: {
  readonly root: string
  readonly appDir: string
  readonly protectedRoots: readonly string[]
  readonly win: boolean
  readonly facts: RelocationFacts
}): { readonly ok: true } | { readonly ok: false; readonly reason: RelocationRejection; readonly detail: string } {
  const { facts, win } = input
  for (const guarded of input.protectedRoots) {
    if (guarded !== '' && within(guarded, input.root, win)) return { ok: false, reason: 'protected-location', detail: guarded }
  }
  if (facts.exists(input.root)) {
    if (facts.isLink(input.root)) return { ok: false, reason: 'root-is-link', detail: input.root }
    const own = new Set([RELOCATION_APP_NAME, RELOCATION_HOME_NAME])
    const stranger = facts.names(input.root).find(name => !own.has(win ? name.toLowerCase() : name))
    if (stranger !== undefined) return { ok: false, reason: 'root-not-empty', detail: join(input.root, stranger) }
  }
  if (facts.exists(input.appDir) && facts.isLink(input.appDir)) return { ok: false, reason: 'root-is-link', detail: input.appDir }
  const probe = facts.exists(input.root) ? input.root : dirname(input.root)
  if (!facts.isWritable(probe)) return { ok: false, reason: 'not-writable', detail: probe }
  return { ok: true }
}

/** 搬家子目录（userData 下）：已校验的安装包副本、助手脚本、助手配置与状态。 */
export const RELOCATION_DIR_NAME = 'relocation'
/** 助手脚本文件名。 */
export const RELOCATION_HELPER_SCRIPT_NAME = 'relocate-helper.ps1'
/** 助手配置（应用写、助手读）。 */
export const RELOCATION_HELPER_CONFIG_NAME = 'relocate-helper.json'
/** 助手状态（助手写、应用下次启动读）。 */
export const RELOCATION_HELPER_STATE_NAME = 'relocate-state.json'

/** 交给助手的配置。 */
export interface RelocationHelperConfig {
  /** 应用主进程：等它退出才动手。 */
  readonly parentPid: number
  /** 已校验的安装包副本（在 userData/relocation 下）。 */
  readonly installer: string
  /** 它的 SHA-256（小写 hex）：助手动手前再核一次。 */
  readonly sha256: string
  readonly fromAppDir: string
  readonly toAppDir: string
  /** 程序 exe 文件名。 */
  readonly exeName: string
  /** 助手写状态的位置。 */
  readonly statePath: string
  /** 最坏情况弹框的标题与正文（应用按界面语言写好，含安装包与数据位置）。 */
  readonly messages: { readonly failedTitle: string; readonly failedBody: string }
}

/** 助手会写下的阶段（与脚本里的 Set-State 一一对应）。 */
export const RELOCATION_HELPER_PHASES = [
  'waiting',
  'aborted-parent-alive',
  'aborted-processes-alive',
  'aborted-installer-changed',
  'installing',
  'installed',
  'install-failed-old-kept',
  'restoring',
  'restored',
  'restore-failed',
  'helper-error',
] as const
export type RelocationHelperPhase = (typeof RELOCATION_HELPER_PHASES)[number]

/**
 * 助手脚本（Windows PowerShell 5.1 起可跑；只用 ASCII，避免编码问题——要给人看的中文
 * 走配置文件里的 messages）。
 *
 * 等待用的是「进程真的没了」：主进程 pid 退出，且再没有任何进程的映像路径在旧程序目录下
 * （Harness、终端宿主、浏览器子进程都算）。等到 10 分钟还有，就放弃、什么都不动、把旧程序
 * 重新打开——不靠安装器的强杀，也不靠 sleep 赌时间。
 * `Start-Process -ArgumentList` 原样拼接参数、不加引号，所以 `/D=` 带空格和中文照常是最后一个、
 * 不带引号的参数（NSIS 的要求）。
 */
export const RELOCATION_HELPER_SCRIPT = String.raw`param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$cfg = [System.IO.File]::ReadAllText($ConfigPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
function Set-State([string]$Phase, [string]$Detail) {
  $json = @{ phase = $Phase; detail = $Detail; at = (Get-Date).ToString('o') } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($cfg.statePath, $json, (New-Object System.Text.UTF8Encoding($false)))
}
function Start-App([string]$Dir) {
  $exe = Join-Path $Dir $cfg.exeName
  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe | Out-Null; return $true }
  return $false
}
# Installing elsewhere first uninstalls the old location (shortcuts included) and recreates them minutes later.
# Keep a copy and put it back whenever it vanishes; the installer overwrites it with the new target at the end.
# The old exe is already gone by then, so the restored link borrows the installer copy's icon (same app icon).
function Invoke-Installer([string]$Dir) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($cfg.exeName) + '.lnk'
  $kept = @{}
  foreach ($folder in 'Desktop', 'Programs') {
    $link = Join-Path ([Environment]::GetFolderPath($folder)) $name
    if (Test-Path -LiteralPath $link) { $kept[$link] = [System.IO.File]::ReadAllBytes($link) }
  }
  $p = Start-Process -FilePath $cfg.installer -ArgumentList @('/S', ('/D=' + $Dir)) -PassThru
  $null = $p.Handle
  while (-not $p.WaitForExit(300)) {
    foreach ($link in $kept.Keys) {
      if (-not (Test-Path -LiteralPath $link)) {
        try {
          [System.IO.File]::WriteAllBytes($link, $kept[$link])
          $sc = (New-Object -ComObject WScript.Shell).CreateShortcut($link)
          $sc.IconLocation = $cfg.installer + ',0'
          $sc.Save()
        } catch { }
      }
    }
  }
  return $p.ExitCode
}
function Show-Failure {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($cfg.messages.failedBody, $cfg.messages.failedTitle) | Out-Null
}
try {
  Set-State 'waiting' ''
  $deadline = (Get-Date).AddMinutes(10)
  while (Get-Process -Id $cfg.parentPid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { Set-State 'aborted-parent-alive' ''; exit 2 }
    Start-Sleep -Milliseconds 500
  }
  $prefix = ($cfg.fromAppDir.TrimEnd('\') + '\').ToLowerInvariant()
  # Path of a process we may not inspect reads as nothing; never let one such process abort the move.
  while (@(Get-Process | Where-Object { try { $_.Path -and $_.Path.ToLowerInvariant().StartsWith($prefix) } catch { $false } }).Count -gt 0) {
    if ((Get-Date) -gt $deadline) { Set-State 'aborted-processes-alive' ''; [void](Start-App $cfg.fromAppDir); exit 2 }
    Start-Sleep -Milliseconds 500
  }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $cfg.installer).Hash.ToLowerInvariant()
  if ($hash -ne $cfg.sha256) { Set-State 'aborted-installer-changed' $hash; [void](Start-App $cfg.fromAppDir); exit 3 }
  Set-State 'installing' ''
  $code = Invoke-Installer $cfg.toAppDir
  if ($code -eq 0 -and (Test-Path -LiteralPath (Join-Path $cfg.toAppDir $cfg.exeName))) {
    Set-State 'installed' ''
    [void](Start-App $cfg.toAppDir)
    exit 0
  }
  if (Start-App $cfg.fromAppDir) { Set-State 'install-failed-old-kept' ('exit ' + $code); exit 4 }
  Set-State 'restoring' ('exit ' + $code)
  $restore = Invoke-Installer $cfg.fromAppDir
  if ($restore -eq 0 -and (Start-App $cfg.fromAppDir)) { Set-State 'restored' ('install exit ' + $code); exit 5 }
  Set-State 'restore-failed' ('install exit ' + $code + '; restore exit ' + $restore)
} catch {
  try { Set-State 'helper-error' $_.Exception.Message } catch { }
  if (Start-App $cfg.fromAppDir) { exit 7 }
}
Show-Failure
exit 6
`

/** 安装器每次安装在本机留的一份自己（installer.nsh customInstall 写同一位置）。 */
export function keptInstallerPath(localAppData: string, version: string): string {
  return join(localAppData, 'DeepSeekGUI', 'installer', `DeepSeekGUI-Setup-${version}.exe`)
}

/** WMI 启动器：在 WmiPrvSE 名下创建助手（隐藏窗口），把新进程 pid 写到 stdout。 */
const WMI_LAUNCHER = [
  "$ErrorActionPreference = 'Stop'",
  '$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }',
  '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:DSG_HELPER_LINE; ProcessStartupInformation = $si }',
  "if ($r.ReturnValue -ne 0) { [Console]::Error.Write('Win32_Process.Create returned ' + $r.ReturnValue); exit 1 }",
  '[Console]::Out.Write($r.ProcessId)',
].join('; ')

/**
 * 启动搬家助手，等它写出第一个状态才算启动成功。
 *
 * 不用 Node 的 `detached`：从资源管理器启动的应用在 Windows 11 上处于系统作业里，
 * detached 起的 powershell 会立刻无声退出、一行脚本都不执行（2026-10-05 在用户机器上实测）。
 * 经 WMI（Win32_Process.Create）创建的进程父进程是 WmiPrvSE，在同一桌面会话、
 * 不在本应用的进程树里，应用退出带不走它。
 *
 * @param scriptPath - 助手脚本。
 * @param configPath - 助手配置；状态文件在同目录下。
 * @param timeoutMs - 等第一个状态的期限。
 * @returns 结束助手的句柄（交接后退出失败时用）。
 * @throws {Error} WMI 创建失败，或期限内助手没有写出状态。
 */
export async function launchRelocationHelper(
  scriptPath: string,
  configPath: string,
  timeoutMs = 10_000,
): Promise<{ kill: () => void }> {
  const statePath = join(dirname(configPath), RELOCATION_HELPER_STATE_NAME)
  const line = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden'
    + ` -File "${scriptPath}" "${configPath}"`
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WMI_LAUNCHER], {
    env: { ...process.env, DSG_HELPER_LINE: line },
    windowsHide: true,
    timeout: 30_000,
  })
  const pid = Number(stdout.trim())
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`WMI returned no process id: ${stdout.trim()}`)
  const kill = (): void => {
    try {
      process.kill(pid)
    } catch {
      // 已经退出。
    }
  }
  const deadline = Date.now() + timeoutMs
  while (!existsSync(statePath)) {
    if (Date.now() > deadline) {
      kill()
      throw new Error(`helper ${String(pid)} wrote no state within ${String(timeoutMs / 1000)}s`)
    }
    await new Promise((done) => { setTimeout(done, 200) })
  }
  return { kill }
}

/**
 * 读助手状态；没有或读不出就是 null。
 * @param userDataDir - Electron userData。
 * @returns 阶段与细节。
 */
export function readHelperState(userDataDir: string): { readonly phase: RelocationHelperPhase; readonly detail: string } | null {
  try {
    const raw = JSON.parse(readFileSync(join(userDataDir, RELOCATION_DIR_NAME, RELOCATION_HELPER_STATE_NAME), 'utf8').replace(/^﻿/u, '')) as { phase?: unknown; detail?: unknown }
    const phase = RELOCATION_HELPER_PHASES.find(known => known === raw.phase)
    return phase === undefined ? null : { phase, detail: typeof raw.detail === 'string' ? raw.detail : '' }
  } catch {
    return null
  }
}

/**
 * 找同一版本安装包的清单地址，按优先顺序：GitHub 上这个版本自己的发布附件
 * （每个版本都带一份 update-manifest.json），然后是当前生效的更新通道、备用通道
 * ——后两者只有在「最新版恰好就是当前版本」时才有用，由调用方核对版本。
 * @param appVersion - 当前 DeepSeekGUI 版本。
 * @param feeds - 当前生效的通道与备用通道（可含 null）。
 * @returns 去重后的候选地址。
 */
export function relocationManifestCandidates(appVersion: string, feeds: readonly (string | null)[]): string[] {
  const own = `https://github.com/See-Sol-Lab/DeepSeekGUI/releases/download/v${appVersion}/update-manifest.json`
  return [...new Set([own, ...feeds.filter((feed): feed is string => feed !== null && feed !== '')])]
}

/**
 * 搬家记录：程序交给安装器之后、新位置启动之前唯一的事实。
 *
 * 运行中的应用在交接后就退出了，新位置的应用（或者安装失败后用户从旧位置重新
 * 打开的应用）靠它知道「上一次是在搬家」。只记判断需要的几个字段，不建第二套
 * Home 状态：数据位置以 launcher state 为准，这里只说程序该去哪。
 */
export interface RelocationRecord {
  readonly schemaVersion: 1
  /** 交给安装器的时刻（ISO）。 */
  readonly startedAt: string
  /** 搬之前的程序目录。 */
  readonly fromAppDir: string
  /** 搬去的程序目录。 */
  readonly toAppDir: string
  /** 搬去的根目录 P/DeepSeekGUI。 */
  readonly root: string
  /** 交接时的应用版本。 */
  readonly version: string
  /** 这次是否连同 Managed Home 一起搬了（Existing Home 时为 false）。 */
  readonly dataMoved: boolean
  /** 数据搬家前的 Home（dataMoved 时有意义）。 */
  readonly fromHome: string
  /** 交给助手的安装包副本（userData/relocation 下）与它的 SHA-256。 */
  readonly installerPath: string
  readonly installerSha256: string
}

/** 读记录：不存在 → null；坏了 → error（fail closed，不当成成功也不当成失败）。 */
export function readRelocationRecord(userDataDir: string): { record: RelocationRecord | null; error: string | null } {
  const path = join(userDataDir, RELOCATION_RECORD_FILENAME)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { record: null, error: null }
    return { record: null, error: String(error instanceof Error ? error.message : error) }
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const str = (key: string): string | null => {
      const value = raw[key]
      return typeof value === 'string' ? value : null
    }
    const startedAt = str('startedAt'), fromAppDir = str('fromAppDir'), toAppDir = str('toAppDir'), root = str('root')
    const version = str('version'), fromHome = str('fromHome'), installerPath = str('installerPath'), installerSha256 = str('installerSha256')
    if (raw.schemaVersion !== 1 || typeof raw.dataMoved !== 'boolean' || startedAt === null || fromAppDir === null || toAppDir === null
      || root === null || version === null || fromHome === null || installerPath === null || installerSha256 === null) {
      return { record: null, error: 'relocation.json has an unexpected shape' }
    }
    return {
      record: {
        schemaVersion: 1, dataMoved: raw.dataMoved, startedAt, fromAppDir, toAppDir, root, version,
        fromHome, installerPath, installerSha256,
      },
      error: null,
    }
  } catch (error) {
    return { record: null, error: String(error instanceof Error ? error.message : error) }
  }
}

/** 写记录（原子替换）。 */
export function writeRelocationRecord(userDataDir: string, record: RelocationRecord): void {
  mkdirSync(userDataDir, { recursive: true })
  atomicWriteFile(
    join(userDataDir, RELOCATION_RECORD_FILENAME),
    `${JSON.stringify(record, null, 2)}\n`,
    message => new Error(`Could not save relocation record: ${message}`),
  )
}

/** 删记录。 */
export function clearRelocationRecord(userDataDir: string): void {
  rmSync(join(userDataDir, RELOCATION_RECORD_FILENAME), { force: true })
}

/**
 * 启动时对照记录判断上一次搬家的结果：只看这次运行的 exe 在哪。
 * - `moved`：exe 已在新程序目录，安装器做完了；
 * - `not-moved`：exe 还在旧目录（安装被取消、失败，或用户在安装器跑完前从旧入口打开）；
 * - `elsewhere`：两边都不是（用户手动装到了别处），只报告事实。
 * @param record - 搬家记录。
 * @param execPath - process.execPath。
 * @param win - 是否 Windows。
 * @returns 结论。
 */
export function relocationOutcome(record: RelocationRecord, execPath: string, win: boolean): 'moved' | 'not-moved' | 'elsewhere' {
  const here = canonical(dirname(execPath), win)
  if (here === canonical(record.toAppDir, win)) return 'moved'
  if (here === canonical(record.fromAppDir, win)) return 'not-moved'
  return 'elsewhere'
}

/** 真实文件系统事实（测试注入替身）。 */
export function nodeRelocationFacts(base: Pick<RelocationFacts, 'isWritable' | 'freeBytes'>): RelocationFacts {
  /** 不存在的路径往上找最近的已存在祖先。 */
  const nearest = (path: string): string => {
    let dir = path
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
    return dir
  }
  return {
    exists: path => existsSync(path),
    names: (path) => {
      try {
        return readdirSync(path)
      } catch {
        return []
      }
    },
    isLink: (path) => {
      try {
        return lstatSync(path).isSymbolicLink()
      } catch {
        return false
      }
    },
    isWritable: path => base.isWritable(nearest(path)),
    freeBytes: path => base.freeBytes(nearest(path)),
  }
}
