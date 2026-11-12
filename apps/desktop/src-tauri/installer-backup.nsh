Var NodrecBackedUpDirectory

Function NodrecBackupBuiltins
  Push $R0
  StrCmp $NodrecBackedUpDirectory $INSTDIR backup_done
  IfFileExists "$INSTDIR\blueprints\builtin\*.nodrec.json" 0 backup_done
  ClearErrors
  CreateDirectory "$INSTDIR\blueprints\.backups"
  IfErrors backup_failed
  GetTempFileName $R0 "$INSTDIR\blueprints\.backups"
  IfErrors backup_failed
  Delete "$R0"
  CreateDirectory "$R0"
  IfErrors backup_failed
  CopyFiles /SILENT /FILESONLY "$INSTDIR\blueprints\builtin\*.nodrec.json" "$R0"
  IfErrors backup_failed
  StrCpy $NodrecBackedUpDirectory $INSTDIR
backup_done:
  Pop $R0
  Return
backup_failed:
  MessageBox MB_OK|MB_ICONSTOP "Cannot back up built-in blueprints. Installation stopped before replacing files." /SD IDOK
  SetErrorLevel 1
  Quit
FunctionEnd
