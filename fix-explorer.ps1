$ErrorActionPreference = 'Continue'

Write-Output "===== STEP 1: Enable WER LocalDumps for Explorer.exe ====="
try {
  $key = "HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting\LocalDumps\Explorer.exe"
  New-Item -Path $key -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $key -Name DumpFolder -Value "C:\Dumps" -PropertyType ExpandString -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $key -Name DumpType   -Value 2          -PropertyType DWord        -Force -ErrorAction Stop | Out-Null
  New-ItemProperty -Path $key -Name DumpCount  -Value 10         -PropertyType DWord        -Force -ErrorAction Stop | Out-Null
  New-Item -Path "C:\Dumps" -ItemType Directory -Force -ErrorAction Stop | Out-Null
  Write-Output "OK: WER dumps -> C:\Dumps (full dump, max 10)"
} catch {
  Write-Output "SKIP STEP 1 (need admin): $($_.Exception.Message)"
}

Write-Output ""
Write-Output "===== STEP 2: Non-Microsoft shell extensions ====="
$approved = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved",
  "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Shell Extensions\Approved"
)
$found = @()
foreach ($p in $approved) {
  if (-not (Test-Path $p)) { continue }
  $props = (Get-Item $p).Property
  foreach ($clsid in $props) {
    $name = (Get-ItemProperty $p -Name $clsid -ErrorAction SilentlyContinue).$clsid
    $dllPath = $null
    foreach ($root in @("Registry::HKEY_CLASSES_ROOT\CLSID\$clsid\InprocServer32",
                        "Registry::HKEY_CLASSES_ROOT\WOW6432Node\CLSID\$clsid\InprocServer32")) {
      $v = (Get-ItemProperty $root -ErrorAction SilentlyContinue).'(default)'
      if ($v) { $dllPath = $v; break }
    }
    if ($dllPath -and $dllPath -notmatch 'System32|SysWOW64') {
      $found += [PSCustomObject]@{ Name = $name; DLL = $dllPath; CLSID = $clsid }
    }
  }
}
$found | Sort-Object DLL -Unique | Format-Table -AutoSize Name, DLL

Write-Output ""
Write-Output "===== STEP 3: Clear thumbnail/icon cache ====="
try {
  Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $cacheDir = "$env:LOCALAPPDATA\Microsoft\Windows\Explorer"
  Get-ChildItem $cacheDir -Filter "thumbcache_*.db" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem $cacheDir -Filter "iconcache_*.db" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Write-Output "OK: thumbnail + icon cache cleared"
} catch {
  Write-Output "WARN: $($_.Exception.Message)"
} finally {
  Start-Process explorer.exe
}

Write-Output ""
Write-Output "===== STEP 4: Quick Access -> This PC + disable recent ====="
try {
  $exp = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
  Set-ItemProperty -Path $exp -Name LaunchTo -Value 1 -Force
  $expSettings = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer"
  Set-ItemProperty -Path $expSettings -Name ShowRecent    -Value 0 -Force -ErrorAction SilentlyContinue
  Set-ItemProperty -Path $expSettings -Name ShowFrequent  -Value 0 -Force -ErrorAction SilentlyContinue
  Write-Output "OK: open to This PC, recent/frequent off"
} catch {
  Write-Output "WARN: $($_.Exception.Message)"
}

Write-Output ""
Write-Output "===== STEP 5: Mapped drives status ====="
$drives = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=4" -ErrorAction SilentlyContinue
if ($drives) {
  $drives | Format-Table -AutoSize DeviceID, ProviderName, FreeSpace, Size
  Write-Output "Tip: disconnect idle ones with: net use X: /delete"
} else {
  Write-Output "No mapped network drives"
}

Write-Output ""
Write-Output "===== DONE. Restart now or sign out/in. Next crash will dump to C:\Dumps ====="