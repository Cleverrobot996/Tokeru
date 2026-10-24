!include LogicLib.nsh

; Tokeru 3.5 安装钩子。
; 每次安装写入独立的版本目录，绝不覆盖正在运行的旧 exe，因此不需要管理员权限。
!macro NSIS_HOOK_PREINSTALL
  ; 选一个尚未被占用的版本目录：app-3.5.0、app-3.5.0-1、app-3.5.0-2 ...
  ; 不要用 $RANDOM 直接拼进 StrCpy，NSIS 在这里会把它当字面量。
  StrCpy $1 0
  StrCpy $2 "$LOCALAPPDATA\Tokeru\app-${VERSION}"
  ${Do}
    ${If} $1 > 0
      StrCpy $2 "$LOCALAPPDATA\Tokeru\app-${VERSION}-$1"
    ${EndIf}
    ${IfNot} ${FileExists} "$2\tokeru.exe"
    ${AndIfNot} ${FileExists} "$2\tokero.exe"
      ${ExitDo}
    ${EndIf}
    IntOp $1 $1 + 1
    ${If} $1 > 50
      IfSilent tokeru_preinstall_nodir
      MessageBox MB_ICONSTOP "同一版本已经安装过太多次，找不到可用的安装目录。请先卸载旧版本后再安装。"
      tokeru_preinstall_nodir:
      Abort
    ${EndIf}
  ${Loop}
  StrCpy $INSTDIR $2

  ; 先建父目录：NSIS 的 CreateDirectory 不会递归创建。
  CreateDirectory "$LOCALAPPDATA\Tokeru"
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"

  ; 用实际写文件验证权限。CreateDirectory 对“目录已存在”也会置错误标记，
  ; 不能只靠它判断失败。
  ; 写测试只用于日志：不要因为 FileOpen 的误报阻断安装，
  ; 真正的写入由后面的 File 阶段决定。
  ClearErrors
  FileOpen $9 ".tokero-write-test" w
  ${If} ${Errors}
    DetailPrint "Tokeru: 写测试未通过（继续尝试安装）"
  ${Else}
    FileWrite $9 "ok"
    FileClose $9
    Delete ".tokero-write-test"
  ${EndIf}
  ClearErrors

  DetailPrint "Tokeru: 安装目录 $INSTDIR"

  ; 同一版本重装时，旧 exe 可能被占用；改名而不是删除。
  ${If} ${FileExists} "$INSTDIR\tokeru.exe"
    Rename "$INSTDIR\tokeru.exe" "$INSTDIR\tokeru.exe.bak"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\tokero.exe"
    Rename "$INSTDIR\tokero.exe" "$INSTDIR\tokero.exe.bak"
  ${EndIf}
!macroend

; 快捷方式指向本次的独立目录；旧版本目录保留，用户可自行卸载。
!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$SMPROGRAMS\Tokeru.lnk"
    CreateShortcut "$SMPROGRAMS\Tokeru.lnk" "$INSTDIR\tokeru.exe"
  ${EndIf}
  ${If} ${FileExists} "$DESKTOP\Tokeru.lnk"
    CreateShortcut "$DESKTOP\Tokeru.lnk" "$INSTDIR\tokeru.exe"
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\tokeru.exe.bak"
  Delete "$INSTDIR\tokero.exe.bak"
  Delete "$INSTDIR\.tokero-write-test"
!macroend