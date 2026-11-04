; Cloak Desk installer (Inno Setup 6).
; Build: iscc /DAppVersion=1.2.3 /DArch=x64 /DSourceDir=..\..\out-x64 CloakDesk.iss
; Output: CloakDesk-Setup-<version>-<arch>.exe
; Per-user install, no admin prompt. The app is framework-dependent: WinUI comes from Microsoft's shared
; Windows App Runtime 1.8. If this PC doesn't have it, setup downloads Microsoft's installer and runs it silently.

#ifndef AppVersion
  #error Pass /DAppVersion=X.Y.Z
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\out-" + Arch
#endif
#if Arch == "arm64"
  #define RuntimeArch "Arm64"
#else
  #define RuntimeArch "X64"
#endif
; Windows App Runtime the app is built against (Microsoft.WindowsAppSDK 1.8) and Microsoft's installer for it.
#define RuntimePackage "Microsoft.WindowsAppRuntime.1.8"
; Lowest runtime the app accepts: the framework package version of Microsoft.WindowsAppSDK.Runtime 1.8.260710003
; (CloakDesk.csproj). Older 1.8 runtimes get updated. CI checks this matches the NuGet package, and that the
; installer at RuntimeUrl provides it.
#define RuntimeMinVersion "8000.921.1539.0"
#define RuntimeUrl "https://aka.ms/windowsappsdk/1.8/latest/windowsappruntimeinstall-" + LowerCase(Arch) + ".exe"
; Numeric part only (1.2.3 of 1.2.3-beta.1) for the Windows file version.
#define NumericVersion Copy(AppVersion, 1, Pos("-", AppVersion + "-") - 1)

[Setup]
AppId={{6F3C2B8E-4D1A-4C57-9E2B-C10AD5E7F3B1}
AppName=Cloak Desk
AppVersion={#AppVersion}
AppVerName=Cloak Desk {#AppVersion}
AppPublisher=Cloak Desk contributors
AppPublisherURL=https://github.com/raktim-yoddha/cloak-desk
AppSupportURL=https://github.com/raktim-yoddha/cloak-desk/issues
AppUpdatesURL=https://github.com/raktim-yoddha/cloak-desk/releases
VersionInfoVersion={#NumericVersion}
VersionInfoProductVersion={#NumericVersion}
VersionInfoProductTextVersion={#AppVersion}
VersionInfoDescription=Cloak Desk {#AppVersion} Setup
DefaultDirName={localappdata}\Programs\Cloak Desk
DefaultGroupName=Cloak Desk
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
#if Arch == "arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
#endif
MinVersion=10.0.19041
OutputDir=output
OutputBaseFilename=CloakDesk-Setup-{#AppVersion}-{#Arch}
SetupIconFile=..\src\CloakDesk\Assets\CloakDesk.ico
UninstallDisplayIcon={app}\CloakDesk.exe
UninstallDisplayName=Cloak Desk {#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startup"; Description: "Start Cloak Desk with Windows (in the notification area)"; Flags: unchecked
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Cloak Desk"; Filename: "{app}\CloakDesk.exe"
Name: "{autodesktop}\Cloak Desk"; Filename: "{app}\CloakDesk.exe"; Tasks: desktopicon

[Registry]
; Same value the app's own "Start with Windows" switch writes.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "CloakDesk"; ValueData: """{app}\CloakDesk.exe"" --tray"; Tasks: startup

[Run]
Filename: "{app}\CloakDesk.exe"; Description: "{cm:LaunchProgram,Cloak Desk}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM CloakDesk.exe"; Flags: runhidden; RunOnceId: "StopCloakDesk"

[Code]
// True if this user already has Microsoft's Windows App Runtime 1.8, new enough, for this architecture.
function RuntimeInstalled: Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "if (Get-AppxPackage -Name ''{#RuntimePackage}'' | Where-Object { $_.Architecture -eq ''{#RuntimeArch}'' -and [version]$_.Version -ge [version]''{#RuntimeMinVersion}'' }) { exit 0 } else { exit 1 }"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

// Before copying files: install the shared runtime if it's missing. It stays when Cloak Desk is uninstalled
// (other apps use it too).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if RuntimeInstalled then
  begin
    Log('Windows App Runtime 1.8 >= {#RuntimeMinVersion} already installed');
    Exit;
  end;
  Log('Downloading {#RuntimeUrl}');
  try
    DownloadTemporaryFile('{#RuntimeUrl}', 'WindowsAppRuntimeInstall.exe', '', nil);
  except
    Log('Download failed: ' + GetExceptionMessage);
    Result := 'Cloak Desk needs the Windows App Runtime 1.8 from Microsoft, and it couldn''t be downloaded. ' +
      'Check your internet connection and run setup again, or install it from {#RuntimeUrl}';
    Exit;
  end;
  if not Exec(ExpandConstant('{tmp}\WindowsAppRuntimeInstall.exe'), '--quiet', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Log('Could not start the runtime installer: ' + SysErrorMessage(Code))
  else
    Log(Format('Runtime installer exit code %d', [Code]));
  if not RuntimeInstalled then
    Result := Format('Installing the Windows App Runtime 1.8 failed (code %d). Install it from {#RuntimeUrl} and run setup again.', [Code]);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  // Remove the autostart value whether the installer or the app's own switch created it. Presets stay.
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'CloakDesk');
end;
