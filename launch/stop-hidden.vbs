' Stop the Hot100 trainer (server + app window), no console window.
Option Explicit
Dim fso, sh, here, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = here & "\stop-hot100.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Missing: " & ps1, 16, "Hot100 - stop failed"
  WScript.Quit 1
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"
sh.Run cmd, 0, False
