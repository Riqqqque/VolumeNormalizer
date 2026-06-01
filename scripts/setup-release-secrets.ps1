param(
  [switch]$FirefoxOnly,
  [switch]$ChromeOnly
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([string]$Name)
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Read-PlainSecret {
  param([string]$Name)

  $secure = Read-Host "Enter $Name (leave blank to skip)" -AsSecureString
  if ($secure.Length -eq 0) {
    return $null
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-GitHubSecret {
  param([string]$Name)

  $value = Read-PlainSecret -Name $Name
  if ([string]::IsNullOrWhiteSpace($value)) {
    Write-Host "Skipped $Name"
    return
  }

  $value | gh secret set $Name
  Write-Host "Saved $Name"
}

if (-not (Test-CommandExists -Name "gh")) {
  throw "GitHub CLI is not installed or is not on PATH."
}

gh auth status | Out-Host

$firefoxSecrets = @(
  "WEB_EXT_API_KEY",
  "WEB_EXT_API_SECRET"
)

$chromeSecrets = @(
  "CHROME_PUBLISHER_ID",
  "CHROME_EXTENSION_ID",
  "CHROME_CLIENT_ID",
  "CHROME_CLIENT_SECRET",
  "CHROME_REFRESH_TOKEN"
)

if (-not $ChromeOnly) {
  Write-Host ""
  Write-Host "Firefox Add-ons secrets"
  Write-Host "Get these from: https://addons.mozilla.org/en-US/developers/addon/api/key/"
  foreach ($secret in $firefoxSecrets) {
    Set-GitHubSecret -Name $secret
  }
}

if (-not $FirefoxOnly) {
  Write-Host ""
  Write-Host "Chrome Web Store secrets"
  Write-Host "Dashboard: https://chrome.google.com/webstore/devconsole/"
  Write-Host "API docs: https://developer.chrome.com/docs/webstore/api/reference/rest"
  foreach ($secret in $chromeSecrets) {
    Set-GitHubSecret -Name $secret
  }
}

Write-Host ""
Write-Host "Current GitHub Actions secrets:"
gh secret list
