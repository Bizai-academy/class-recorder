; Bộ cài Class Recorder cho Windows (Inno Setup 6). Dựng bằng: node scripts/build.mjs
; Cài cho riêng người dùng hiện tại (không cần quyền quản trị), vì app ghi cài đặt và dữ liệu ngay trong thư mục cài.
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\ClassRecorder"
#endif

[Setup]
AppId={{6C1B7E52-4B0E-4E55-9A39-5E1C7D2A9F10}
AppName=Class Recorder
AppVersion={#AppVersion}
AppPublisher=Class Recorder
DefaultDirName={localappdata}\Programs\Class Recorder
DefaultGroupName=Class Recorder
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ClassRecorder-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Class Recorder

[Tasks]
Name: "desktopicon"; Description: "Tạo biểu tượng trên màn hình nền"; GroupDescription: "Biểu tượng:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Class Recorder"; Filename: "{app}\Class Recorder.bat"; WorkingDir: "{app}"
Name: "{autodesktop}\Class Recorder"; Filename: "{app}\Class Recorder.bat"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Class Recorder.bat"; Description: "Mở Class Recorder"; Flags: nowait postinstall skipifsilent shellexec

; Gỡ cài đặt chỉ xoá file chương trình. Thư mục data (video, phiên âm, tóm tắt) và file .env (key) được giữ lại.
