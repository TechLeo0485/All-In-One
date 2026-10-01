; Extra steps for the All-In-One installer (electron-builder NSIS "include").
; Keep the AppUserModelId in sync with src/shared/brand.ts (APP_ID).

!macro customUnInstall
  ; Notification identity registered by the app (name + icon shown on toasts).
  DeleteRegKey HKCU "Software\Classes\AppUserModelId\com.all-in-one.app"
!macroend
