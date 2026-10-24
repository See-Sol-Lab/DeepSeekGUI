; DeepSeekGUI 迁移助手的外壳：DeepSeekGUI 自动更新下载、核对 SHA-256 后用 ShellExecute 打开它。
; 只负责把 migrate.ps1 与 init-desktop-profile.mjs 解到临时插件目录，再用系统自带的 PowerShell 跑；
; 界面、日志和每一步的工作都在 migrate.ps1 里（中文经 nsExec 读回会乱码，所以不用 NSIS 的日志窗）。
; 构建：makensis /DVERSION=1.3.0 migrate.nsi
Unicode true
!ifndef VERSION
  !define VERSION "1.3.0"
!endif
Name "DeepSeekGUI 迁移助手"
OutFile "DeepSeekGUI-Migrate-${VERSION}.exe"
Icon "..\build\icon.ico"
RequestExecutionLevel user
SilentInstall silent
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "DeepSeekGUI 迁移助手"
VIAddVersionKey "FileDescription" "迁移到官方 DeepSeek Harness 桌面端 + DSH 生活质量包"
VIAddVersionKey "CompanyName" "See-Sol-Lab"
VIAddVersionKey "LegalCopyright" "See-Sol-Lab"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "migrate.ps1"
  File "init-desktop-profile.mjs"
  File "merge-data.mjs"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\migrate.ps1"' $0
SectionEnd
