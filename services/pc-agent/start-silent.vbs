' Rotax 915 iS Sentinel — Silent Background Launcher
' Starts agent.py with 0 visible command prompt windows.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ScriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
AgentPath = ScriptDir & "\agent.py"

' Look for pythonw.exe first (designed for windowless background scripts)
PythonCmd = "pythonw.exe """ & AgentPath & """"

On Error Resume Next
Ret = WshShell.Run(PythonCmd, 0, False)
If Err.Number <> 0 Then
    ' Fall back to standard python.exe hidden
    Err.Clear
    PythonCmd = "python.exe """ & AgentPath & """"
    WshShell.Run PythonCmd, 0, False
End If
