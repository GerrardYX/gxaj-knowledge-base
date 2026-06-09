; gxaj知识库 安装脚本片段
; 由 electron-builder NSIS include 引入
; 功能：自动将安装目录加入 Windows Defender 排除项，显著加快后续启动速度

!macro customInstall
  DetailPrint "正在配置 Windows Defender 排除项（优化启动速度）..."

  ; 获取安装目录（NSIS 变量 $INSTDIR）
  StrCpy $0 "$INSTDIR"

  ; 通过 PowerShell 添加排除项（静默执行，不弹窗）
  nsExec::ExecToLog 'powershell.exe -NoProfile -WindowStyle Hidden -Command "try { Add-MpPreference -ExclusionPath \"$0\" -ErrorAction Stop; Write-Host \"[gxaj] Defender 排除项已添加: $0\" } catch { Write-Host \"[gxaj] Defender 排除项添加失败: $_\" }"'

  DetailPrint "Defender 排除项配置完成"
!macroend

!macro customUnInstall
  ; 卸载时移除排除项
  StrCpy $0 "$INSTDIR"
  nsExec::ExecToLog 'powershell.exe -NoProfile -WindowStyle Hidden -Command "try { Remove-MpPreference -ExclusionPath \"$0\" -ErrorAction Stop } catch {}"'
!macroend
