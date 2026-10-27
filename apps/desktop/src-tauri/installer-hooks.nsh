!define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
Var NodrecNoShortcutMode

!macro NSIS_HOOK_PREINSTALL
  ; Tauri otherwise creates desktop shortcuts unconditionally in passive/silent mode.
  StrCpy $NodrecNoShortcutMode $NoShortcutMode
  StrCpy $NoShortcutMode 1
!macroend

!macro NSIS_HOOK_POSTINSTALL
  StrCpy $NoShortcutMode $NodrecNoShortcutMode
  Call CreateOrUpdateStartMenuShortcut
!macroend
