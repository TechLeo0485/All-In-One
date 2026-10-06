; Extra steps for the All-In-One installer (electron-builder NSIS "include").
; Keep the AppUserModelId in sync with src/shared/brand.ts (APP_ID).

; "Is the app running?" check, used by both the installer and the uninstaller.
; electron-builder's default starts PowerShell up to three times (Get-CimInstance
; Win32_Process) with nsExec, which blocks the installer window. On the first run
; (cold PowerShell, antivirus scanning it, WMI starting) that can take many seconds,
; so the window shows "Not responding". nsProcess checks the process list in-process
; and returns immediately.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK aioStopApp
      Quit
    ${endIf}

    aioStopApp:
    DetailPrint "$(appClosing)"
    ; An auto-update quits the app itself; give it a moment before forcing it.
    ; (A polite WM_CLOSE wouldn't help: closing the window only hides it to the tray.)
    StrCpy $R1 0
    aioWaitLoop:
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
      ${andIf} $R1 < 6
        IntOp $R1 $R1 + 1
        Sleep 500
        Goto aioWaitLoop
      ${endIf}

    aioKillLoop:
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ; SQLite is crash-safe (WAL), so a forced stop can't corrupt the database.
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1000 ; let Windows release the files
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          ; Still running (e.g. started as administrator): ask the user to close it.
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY aioKillLoop
          Quit
        ${endIf}
      ${endIf}
  ${endIf}
  ${nsProcess::Unload}
!macroend

!macro customUnInstall
  ; Notification identity registered by the app (name + icon shown on toasts).
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\com.all-in-one.app"
!macroend
