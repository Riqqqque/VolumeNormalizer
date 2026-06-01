param(
  [switch]$Chrome,
  [switch]$Firefox
)

$ErrorActionPreference = "Stop"

if (-not $Chrome -and -not $Firefox) {
  $Chrome = $true
  $Firefox = $true
}

gh workflow run "Extension Release" `
  -f publish_chrome=$($Chrome.ToString().ToLowerInvariant()) `
  -f publish_firefox=$($Firefox.ToString().ToLowerInvariant())

Write-Host "Started Extension Release workflow."
gh run list --workflow "Extension Release" --limit 3
