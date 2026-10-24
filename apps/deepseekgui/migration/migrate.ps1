# DeepSeekGUI 迁移助手：把 DeepSeekGUI 用户迁到「官方 DeepSeek Harness 桌面端 + DSH 生活质量包」。
# 由 DeepSeekGUI 的自动更新下载并运行（外层是 NSIS 壳 migrate.nsi，本脚本在 $PLUGINSDIR 里）。
#
# 顺序（2026-10-24 在隔离目录实测定下）：
#   1 等 DeepSeekGUI 完全退出   2 找到 GUI 的数据目录
#   3 官方桌面端：没装就从官方更新源下载，核对大小、SHA-512、代码签名（杭州深度求索）后静默安装
#   4 合并数据（merge-data.mjs）：会话、凭据、工作区列表、全局记忆等根层共享数据补进官方的 DSH 目录（不带 profiles）；
#     官方已有的一律不改，只补它没有的；要改的几个文件先备份到 deepseekgui\migration-backup
#   5 用官方运行时自己的 initProfile 初始化 desktop profile，再用官方 dsh 命令装生活质量包
#   6 打开官方桌面端
# 任何一步失败就停下，说明是哪一步；DeepSeekGUI 本身和它的数据一律不改、不删，照常能用。
#
# 仅测试用的环境变量：DSHQOL_MIGRATE_TEST_OFFICIAL_DIR（已解压的官方端目录，跳过下载安装）、
# DSHQOL_MIGRATE_TEST_GUI_USERDATA（GUI 的 userData）、DSHQOL_MIGRATE_TEST_AUTOSTART（自动开始，结束时把日志写到这个路径并关窗）。
# 目标目录认官方自己的 DSH_HOME，缺省 ~/.dsh。

Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$sync = [hashtable]::Synchronized(@{ Log = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue)); Progress = 0; State = 'idle'; Official = $null; Ask = $null; Answer = $null })

$work = {
  param($sync, $here)
  $ErrorActionPreference = 'Stop'
  $QolUrl = 'https://github.com/See-Sol-Lab/DSH-QoL/releases/download/v1.0.0/see-sol-lab-dsh-qol-1.0.0.tgz'
  $Feed = 'https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'
  $Signer = 'Hangzhou DeepSeek Artificial Intelligence Co., Ltd.'
  function Say([string]$t) { $sync.Log.Enqueue($t) }
  function Step([int]$n, [string]$t) { $sync.Progress = [int](($n - 1) * 100 / 6); Say ''; Say "[$n/6] $t" }
  function Fail([string]$why) { throw $why }
  # 需要用户动手时（比如先退出某个程序）：挂一个问题给界面，等用户点「继续」或「取消」
  function AskUser([string]$q) {
    $sync.Answer = $null; $sync.Ask = $q
    while ($null -eq $sync.Answer) { Start-Sleep -Milliseconds 300 }
    $a = $sync.Answer; $sync.Ask = $null; $sync.Answer = $null
    if ($a -ne 'continue') { Fail '已取消。' }
  }
  function WaitExit([string]$name, [string]$label) {
    for ($i = 0; $i -lt 40; $i++) { if (-not (Get-Process -Name $name -ErrorAction SilentlyContinue)) { return }; Start-Sleep -Milliseconds 500 }
    while (Get-Process -Name $name -ErrorAction SilentlyContinue) { AskUser "$label 还在运行。请从任务栏右下角的托盘图标完全退出它，然后点「继续」。" }
  }
  function OfficialInstall {
    $keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
    foreach ($k in Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue) {
      if ($k.DisplayName -like 'DeepSeek Harness*' -and $k.InstallLocation -and (Test-Path (Join-Path $k.InstallLocation 'DeepSeek Harness.exe'))) { return $k.InstallLocation.TrimEnd('\') }
    }
    $default = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'
    if (Test-Path (Join-Path $default 'DeepSeek Harness.exe')) { return $default }
    return $null
  }
  # 以官方端程序当 Node 跑一个脚本：它是窗口程序，PowerShell 拿不到输出也未必等它，所以用 Start-Process -Wait 取退出码
  function RunNode([string[]]$argv) {
    $env:ELECTRON_RUN_AS_NODE = '1'
    try {
      $q = ($argv | ForEach-Object { '"' + $_.TrimEnd('\') + '"' }) -join ' '
      return (Start-Process -FilePath $exe -ArgumentList $q -Wait -PassThru -WindowStyle Hidden).ExitCode
    } finally { Remove-Item Env:ELECTRON_RUN_AS_NODE }
  }
  function FeedValue([string]$yml, [string]$key) {
    $m = [regex]::Match($yml, "(?m)^$key\s*:\s*(?:>-\s*\r?\n\s*)?(\S+)")
    if (-not $m.Success) { Fail "官方更新清单里缺少 $key" }
    return $m.Groups[1].Value.Trim("'", '"')
  }

  try {
    $sync.State = 'running'

    Step 1 '等 DeepSeekGUI 完全退出'
    WaitExit 'DeepSeekGUI' 'DeepSeekGUI'
    Say 'DeepSeekGUI 已退出。'

    Step 2 '找到 DeepSeekGUI 的数据'
    $userData = if ($env:DSHQOL_MIGRATE_TEST_GUI_USERDATA) { $env:DSHQOL_MIGRATE_TEST_GUI_USERDATA } else { Join-Path $env:APPDATA 'DeepSeekGUI' }
    $guiHome = $null
    $statePath = Join-Path $userData 'launcher-state.json'
    if (Test-Path $statePath) {
      $st = Get-Content -Raw -Encoding UTF8 $statePath | ConvertFrom-Json
      $h = $st.active.home
      if ($h.kind -eq 'existing' -and $h.path) { $guiHome = $h.path }
      elseif ($h.kind -eq 'managed' -and $h.root) { $guiHome = $h.root }
    }
    if (-not $guiHome) {
      $ptr = Join-Path $env:LOCALAPPDATA 'DeepSeekGUI\managed-home.txt'
      if (Test-Path $ptr) { $guiHome = [System.IO.File]::ReadAllText($ptr, [System.Text.Encoding]::Unicode).Trim() }
    }
    if (-not $guiHome) { $guiHome = Join-Path $userData 'dsh' }
    $target = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
    Say "DeepSeekGUI 的数据：$guiHome"
    Say "官方桌面端的数据目录：$target"

    Step 3 '准备官方桌面端'
    $official = if ($env:DSHQOL_MIGRATE_TEST_OFFICIAL_DIR) { $env:DSHQOL_MIGRATE_TEST_OFFICIAL_DIR } else { OfficialInstall }
    if ($official) {
      Say "已经装有官方桌面端：$official"
    } else {
      Say '从官方更新源读取最新版本……'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $yml = (New-Object Net.WebClient).DownloadString($Feed)
      $version = FeedValue $yml 'version'
      $url = FeedValue $yml 'path'
      $sha = FeedValue $yml 'sha512'
      $size = [int64](FeedValue $yml '\s*size')
      if ($url -notmatch '^https://download\.deepseek\.com/') { Fail "官方更新清单里的下载地址不在 download.deepseek.com：$url" }
      Say "官方桌面端 $version，$([math]::Round($size / 1MB)) MB，开始下载……"
      $setup = Join-Path ([IO.Path]::GetTempPath()) "deepseek-harness-$version-win-x64.exe"
      $req = [Net.HttpWebRequest]::Create($url); $resp = $req.GetResponse(); $in = $resp.GetResponseStream()
      $out = [IO.File]::Create($setup); $buf = New-Object byte[] 1048576; $got = [int64]0; $shown = 0
      try {
        while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) { $out.Write($buf, 0, $n); $got += $n; $sync.Progress = 33 + [int](17 * $got / [math]::Max($size, 1)); $tenth = [int][math]::Floor(10 * $got / [math]::Max($size, 1)); if ($tenth -gt $shown) { $shown = $tenth; Say "  已下载 $([math]::Round($got / 1MB)) / $([math]::Round($size / 1MB)) MB" } }
      } finally { $out.Close(); $in.Close(); $resp.Close() }
      if ($got -ne $size) { Fail "下载大小不对（应为 $size，实际 $got）" }
      $sha512 = [Security.Cryptography.SHA512]::Create(); $fs = [IO.File]::OpenRead($setup)
      try { $actual = [Convert]::ToBase64String($sha512.ComputeHash($fs)) } finally { $fs.Close() }
      if ($actual -ne $sha) { Fail '下载的安装包 SHA-512 和官方清单不一致，已停止，没有安装' }
      $sig = Get-AuthenticodeSignature $setup
      if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike "*$Signer*") { Fail "安装包签名不是杭州深度求索的有效签名（$($sig.Status)），已停止，没有安装" }
      Say '大小、SHA-512、代码签名都已核对。正在安装官方桌面端……'
      $p = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
      if ($p.ExitCode -ne 0) { Fail "官方安装程序返回 $($p.ExitCode)" }
      Remove-Item $setup -ErrorAction SilentlyContinue
      $official = OfficialInstall
      if (-not $official) { Fail '官方桌面端装完了，但找不到它的安装位置' }
      Say "官方桌面端已安装：$official"
    }
    $sync.Official = $official
    $exe = Join-Path $official 'DeepSeek Harness.exe'
    $dsh = Join-Path $official 'resources\runtime\cli\bin\dsh.cmd'
    WaitExit 'DeepSeek Harness' '官方桌面端'

    Step 4 '合并会话、凭据和记忆'
    $same = (Test-Path $guiHome) -and (Test-Path $target) -and ((Resolve-Path $guiHome).Path.TrimEnd('\') -ieq (Resolve-Path $target).Path.TrimEnd('\'))
    $hasData = (Test-Path (Join-Path $target '.credentials.yaml')) -or ((Test-Path (Join-Path $target 'sessions')) -and (Get-ChildItem (Join-Path $target 'sessions') -Force | Select-Object -First 1))
    if ($same) {
      Say 'DeepSeekGUI 和官方桌面端用的是同一个数据目录，不用复制。'
    } elseif (-not (Test-Path $guiHome)) {
      Say '没有找到 DeepSeekGUI 的数据，跳过这一步。'
    } else {
      if ($hasData) { Say '官方桌面端里已经有你的数据：只补进 DeepSeekGUI 那边多出来的，官方已有的会话、密钥和设置都不改。' }
      # 合并在 Node 里做（官方运行时自带的 yaml 库；Node 也不受 260 字符路径限制）
      $reportFile = Join-Path ([IO.Path]::GetTempPath()) "deepseekgui-merge-$PID.json"
      Remove-Item $reportFile -ErrorAction SilentlyContinue
      $code = RunNode @((Join-Path $here 'merge-data.mjs'), $official, $guiHome, $target, $reportFile)
      $json = if (Test-Path $reportFile) { Get-Content -Raw -Encoding UTF8 $reportFile } else { $null }
      Remove-Item $reportFile -ErrorAction SilentlyContinue
      if ($code -ne 0 -or -not $json) {
        Say "  （合并脚本退出码 $code）"
        Fail '合并数据时出错。官方原有文件改动前都备份在它数据目录的 deepseekgui\migration-backup 里'
      }
      $r = $json | ConvertFrom-Json
      Say "  会话：补进 $($r.sessionsAdded) 个"
      if ($r.workspacesAdded -or $r.workspacesMerged) { Say "  工作区：新加 $($r.workspacesAdded) 个，合并同路径的 $($r.workspacesMerged) 个" }
      if ($r.credentialsAdded.Count) { Say '  凭据：补进了官方那边没有的 API 密钥或登录信息' }
      if ($r.credentialsKept -contains 'DEEPSEEK_API_KEY') { Say '  官方桌面端已有 API 密钥，保留官方那边的' }
      if ($r.notes -contains 'appended-memory.md') { Say '  全局记忆：两边都有，DeepSeekGUI 的内容接在了后面' }
      if ($r.notes -contains 'workspace-version-mismatch') { Say '  工作区列表格式版本不同，没有合并工作区列表（会话文件已补进）' }
      Say "完成。DeepSeekGUI 那份数据没有动，仍在：$guiHome"
    }

    Step 5 '装上 DSH 生活质量包'
    $profileDir = Join-Path $target 'profiles\desktop'
    $manifest = Join-Path $profileDir 'package.json'
    $null = RunNode @((Join-Path $here 'init-desktop-profile.mjs'), $official, $target)
    if (-not (Test-Path $manifest)) { Fail '没能初始化官方桌面端的插件目录' }
    if ((Get-Content -Raw -Encoding UTF8 $manifest) -match '"@see-sol-lab/dsh-qol"') {
      Say '生活质量包已经装过了。'
    } else {
      Say '正在从 GitHub 下载并安装生活质量包……'
      $env:DSH_HOME = $target
      $log = & $dsh plugin --profile desktop add $QolUrl 2>&1
      $code = $LASTEXITCODE
      if ($code -ne 0 -or -not ((Get-Content -Raw -Encoding UTF8 $manifest) -match '"@see-sol-lab/dsh-qol"')) {
        foreach ($l in ($log | Select-Object -Last 6)) { Say "  $l" }
        Fail '生活质量包没有装上（多半是网络连不上 GitHub）。官方桌面端已经能用；网络好了以后再运行一次本程序即可补装'
      }
      Say '生活质量包已安装。'
    }

    Step 6 '打开官方桌面端'
    Start-Process -FilePath $exe
    $sync.Progress = 100
    Say ''
    Say '迁移完成。以后官方桌面端会自己更新，不再需要 DeepSeekGUI。'
    Say 'DeepSeekGUI 和它的数据都还在，确认官方桌面端一切正常后，可以在「设置 → 应用」里卸载 DeepSeekGUI。'
    $sync.State = 'done'
  } catch {
    Say ''
    Say "没有完成：$($_.Exception.Message)"
    Say 'DeepSeekGUI 和它的数据没有被改动，可以照常打开使用。'
    $sync.State = 'failed'
  }
}

# ---- 界面 ----
$form = New-Object Windows.Forms.Form
$form.Text = 'DeepSeekGUI 迁移助手'
$form.Size = New-Object Drawing.Size(640, 600)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9)
$form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false

$intro = New-Object Windows.Forms.Label
$intro.Location = New-Object Drawing.Point(16, 14); $intro.Size = New-Object Drawing.Size(600, 200)
$intro.Text = "DeepSeekGUI 从这个版本起不再跟随官方更新，改为「官方 DeepSeek Harness 桌面端 + DSH 生活质量包」。`r`n`r`n为什么：官方推出自己的桌面端以后，它的更新方向、开发理念与 DeepSeekGUI 有不小的分歧；官方的破坏性更新又很频繁，DeepSeekGUI 由一个人维护，每次整体合并再把自己的改动接回去，已经越来越难跟上。所以今后由官方桌面端自己自动更新，DeepSeekGUI 里官方还没有的功能做成「DSH 生活质量包」插件继续维护，皮肤、工作台、记忆、技能库、用量等都在里面，用起来和 DeepSeekGUI 相近。`r`n`r`n这个助手会：从官方下载并安装桌面端（核对校验值和代码签名）；把你在 DeepSeekGUI 里的会话、API 密钥和全局记忆合并到官方桌面端（官方那边已有的不会被覆盖）；装上生活质量包；最后打开官方桌面端。下载要一会儿，请耐心等待。`r`n`r`nDeepSeekGUI 本身和它的数据不会被改动或删除。"
$form.Controls.Add($intro)

$bar = New-Object Windows.Forms.ProgressBar
$bar.Location = New-Object Drawing.Point(16, 220); $bar.Size = New-Object Drawing.Size(592, 18)
$form.Controls.Add($bar)

$box = New-Object Windows.Forms.TextBox
$box.Location = New-Object Drawing.Point(16, 248); $box.Size = New-Object Drawing.Size(592, 250)
$box.Multiline = $true; $box.ReadOnly = $true; $box.ScrollBars = 'Vertical'; $box.BackColor = [Drawing.Color]::White
$form.Controls.Add($box)

$primary = New-Object Windows.Forms.Button
$primary.Location = New-Object Drawing.Point(408, 510); $primary.Size = New-Object Drawing.Size(100, 30); $primary.Text = '开始迁移'
$form.Controls.Add($primary)
$secondary = New-Object Windows.Forms.Button
$secondary.Location = New-Object Drawing.Point(516, 510); $secondary.Size = New-Object Drawing.Size(92, 30); $secondary.Text = '以后再说'
$form.Controls.Add($secondary)

$ps = $null; $handle = $null
$primary.Add_Click({
  switch ($primary.Text) {
    '开始迁移' {
      $primary.Enabled = $false; $secondary.Enabled = $false
      $script:ps = [PowerShell]::Create().AddScript($work).AddArgument($sync).AddArgument($here)
      $script:handle = $ps.BeginInvoke()
    }
    '继续' { $sync.Answer = 'continue'; $primary.Enabled = $false; $secondary.Enabled = $false }
    default { $form.Close() }
  }
})
$secondary.Add_Click({ if ($sync.Ask) { $sync.Answer = 'cancel'; $primary.Enabled = $false; $secondary.Enabled = $false } else { $form.Close() } })

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
  while ($sync.Log.Count -gt 0) { $box.AppendText([string]$sync.Log.Dequeue() + "`r`n") }
  $bar.Value = [math]::Min(100, [math]::Max(0, $sync.Progress))
  if ($sync.Ask -and -not $primary.Enabled) {
    $box.AppendText("`r`n" + $sync.Ask + "`r`n")
    $primary.Text = '继续'; $secondary.Text = '取消'; $primary.Enabled = $true; $secondary.Enabled = $true
  }
  if ($sync.State -eq 'done' -or $sync.State -eq 'failed') {
    $timer.Stop(); $primary.Text = '关闭'; $primary.Enabled = $true; $secondary.Visible = $false
    if ($env:DSHQOL_MIGRATE_TEST_AUTOSTART) { [IO.File]::WriteAllText($env:DSHQOL_MIGRATE_TEST_AUTOSTART, $sync.State + "`r`n" + $box.Text); $form.Close() }
  }
})
$timer.Start()
if ($env:DSHQOL_MIGRATE_TEST_AUTOSTART) { $form.Add_Shown({ $primary.PerformClick() }) }
$form.Add_FormClosing({ param($s, $e) if ($sync.State -eq 'running') { $e.Cancel = $true } })
[void]$form.ShowDialog()
