!ifndef DEEPSEEKGUI_REMOVE_TREE
!define DEEPSEEKGUI_REMOVE_TREE

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
!endif
