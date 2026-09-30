!ifndef DEEPSEEKGUI_REMOVE_TREE
!define DEEPSEEKGUI_REMOVE_TREE

Var DeepSeekGuiKeptDir

# Stack: absolute path -> failure count. Reparse points are removed as links.
# Registers are preserved across recursion. Callers validate the root first.
Function un.DeepSeekGuiRemoveTree
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $4 0
  System::Call 'kernel32::GetFileAttributesW(w r0) i.r1'
  IntCmp $1 -1 attributesFailed
  IntOp $2 $1 & 0x10
  IntCmp $2 0 removeFile
  IntOp $2 $1 & 0x400
  IntCmp $2 0 enumerate removeDirectory removeDirectory

  enumerate:
    FindFirst $2 $3 "$0\*"
    nextEntry:
      StrCmp $3 "" endEntries
      StrCmp $3 "." skipEntry
      StrCmp $3 ".." skipEntry
      Push "$0\$3"
      Call un.DeepSeekGuiRemoveTree
      Pop $1
      IntOp $4 $4 + $1
    skipEntry:
      FindNext $2 $3
      Goto nextEntry
    endEntries:
      FindClose $2

  removeDirectory:
    ClearErrors
    RMDir "$0"
    Goto checkRemoval
  removeFile:
    ClearErrors
    Delete "$0"
  checkRemoval:
    IfErrors 0 done
    IntOp $4 $4 + 1
    Goto done
  attributesFailed:
    System::Call 'kernel32::GetLastError() i.r1'
    IntCmp $1 2 done
    IntCmp $1 3 done
    IntOp $4 $4 + 1
  done:
    StrCpy $0 $4
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

!macro DeepSeekGuiRemoveTree PATH
  Push "${PATH}"
  Call un.DeepSeekGuiRemoveTree
  Pop $R7
  IntOp $R8 $R8 + $R7
!macroend

# 住户 2026-09-29: files kept across a "delete data" uninstall. KEEP copies an
# existing file into this uninstall's temporary directory before the data folder goes (a failed
# copy counts in $R8, and the caller then deletes nothing); RESTORE puts it
# back into the default Managed Home and removes the kept copy (a failure
# counts in $R8 and the copy stays).
!macro DeepSeekGuiKeepFile SOURCE NAME
  ${if} ${FileExists} "${SOURCE}"
    ClearErrors
    CopyFiles /SILENT "${SOURCE}" "$DeepSeekGuiKeptDir\${NAME}"
    ${if} ${Errors}
    ${orifnot} ${FileExists} "$DeepSeekGuiKeptDir\${NAME}"
      IntOp $R8 $R8 + 1
    ${endif}
  ${endif}
!macroend

!macro DeepSeekGuiRestoreFile NAME
  ${if} ${FileExists} "$DeepSeekGuiKeptDir\${NAME}"
    CreateDirectory "$APPDATA\${APP_FILENAME}\dsh"
    ClearErrors
    CopyFiles /SILENT "$DeepSeekGuiKeptDir\${NAME}" "$APPDATA\${APP_FILENAME}\dsh\${NAME}"
    ${if} ${Errors}
    ${orifnot} ${FileExists} "$APPDATA\${APP_FILENAME}\dsh\${NAME}"
      IntOp $R8 $R8 + 1
    ${else}
      Delete "$DeepSeekGuiKeptDir\${NAME}"
    ${endif}
  ${endif}
!macroend
!endif
