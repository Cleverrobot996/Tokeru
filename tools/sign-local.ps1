# Sign Tokeru 4.0 artifacts with the local self-signed code-signing certificate.
# The certificate is trusted only in the current Windows user profile.
$ErrorActionPreference = "Stop"
$thumb = "9F74324389BD46A7D098B6B05F18C060470AFF2A"
$signtool = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\signtool.exe"
$root = Split-Path -Parent $PSScriptRoot
$files = @(
  (Join-Path $root "src-tauri\target\release\tokeru.exe"),
  (Join-Path $root "src-tauri\target\release\bundle\nsis\Tokeru_4.0.0_x64-setup.exe"),
  (Join-Path $root "dist-portable\Tokeru\Tokeru.exe")
)
foreach ($f in $files) {
  if (-not (Test-Path $f)) {
    Write-Warning "skip missing: $f"
    continue
  }
  & $signtool sign /fd SHA256 /sha1 $thumb /s My /d "Tokeru" $f
  if ($LASTEXITCODE -ne 0) { throw "sign failed: $f" }
  $s = Get-AuthenticodeSignature $f
  Write-Output ("$f => " + $s.Status)
}
