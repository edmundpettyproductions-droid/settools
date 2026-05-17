Option Explicit
Dim oShell, strDir, strPS1
Set oShell = CreateObject("WScript.Shell")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
strPS1 = strDir & "_tools\SetTools_launcher.ps1"
oShell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & strPS1 & """", 0, False
Set oShell = Nothing
