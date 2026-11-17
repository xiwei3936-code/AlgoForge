' Launch Hot100 trainer with NO console window at all.
' wscript.exe is a GUI host, so nothing flashes on screen.
Option Explicit
Dim fso, sh, here, ps1, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
ps1  = here & "\start-hot100.ps1"
If Not fso.FileExists(ps1) Then
  MsgBox "Missing: " & ps1 & vbCrLf & vbCrLf & _
         "The launcher script was not found (antivirus may have removed it).", _
         16, "Hot100 - launch failed"
  WScript.Quit 1
End If
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """ -Hidden"
' 0 = hidden window, False = do not wait
sh.Run cmd, 0, False
