!macro customInstall
  CreateDirectory "$INSTDIR\user-data"
  ; All-user installs need a writable data folder without making program files writable.
  ${If} $installMode == "all"
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\user-data" /grant *S-1-5-32-545:(OI)(CI)M'
    Pop $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "Cannot make the user-data folder writable. Please install in a writable folder."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro removeMovieGlacierData INSTALL_DIR LEGACY_DIR
  RMDir /r "${INSTALL_DIR}\user-data"
  RMDir /r "${LEGACY_DIR}\movie-glacier"
  RMDir /r "${LEGACY_DIR}\Movie Glacier"
  RMDir /r "${LEGACY_DIR}\私人影视库"
!macroend

!macro customUnInstall
  ; Upgrades and silent uninstalls always preserve data.
  ${IfNot} ${isUpdated}
  ${AndIfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否删除所有用户信息？ / Delete all user data?$\r$\n$\r$\n选择“是”将删除设置、片库索引、收藏、海报及登录会话，以及当前用户的旧版 AppData 备份。$\r$\nYes deletes settings, library records, favorites, artwork, sessions and this user's legacy AppData backups.$\r$\n$\r$\n电影和剧集源文件不会删除。选择“否”可保留数据供重新安装使用。$\r$\nMedia files are kept. Choose No to keep data for reinstalling." IDNO keepUserData
    SetShellVarContext current
    !insertmacro removeMovieGlacierData "$INSTDIR" "$APPDATA"
    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
    keepUserData:
  ${EndIf}
!macroend

!macro customRemoveFiles
  SetOutPath $TEMP
  !include "${BUILD_RESOURCES_DIR}\uninstall-files.nsh"
  RMDir "$INSTDIR"
!macroend
