$ErrorActionPreference = "Stop"

$chromeScope = "https://www.googleapis.com/auth/chromewebstore"

function Test-CommandExists {
  param([string]$Name)
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Read-PlainSecret {
  param([string]$Name)

  $secure = Read-Host "Enter $Name" -AsSecureString
  if ($secure.Length -eq 0) {
    throw "$Name is required."
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Set-GitHubSecret {
  param(
    [string]$Name,
    [string]$Value
  )

  $Value | gh secret set $Name
  Write-Host "Saved $Name"
}

function ConvertFrom-QueryString {
  param([string]$Query)

  $values = @{}
  $trimmedQuery = $Query.TrimStart("?")
  if ([string]::IsNullOrWhiteSpace($trimmedQuery)) {
    return $values
  }

  foreach ($pair in $trimmedQuery.Split("&")) {
    if ([string]::IsNullOrWhiteSpace($pair)) {
      continue
    }

    $parts = $pair.Split("=", 2)
    $name = [Uri]::UnescapeDataString($parts[0].Replace("+", " "))
    $value = ""
    if ($parts.Length -gt 1) {
      $value = [Uri]::UnescapeDataString($parts[1].Replace("+", " "))
    }
    $values[$name] = $value
  }

  return $values
}

function Receive-OAuthCode {
  param(
    [string]$ClientId,
    [string]$RedirectUri
  )

  $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), ([Uri]$RedirectUri).Port)
  $listener.Start()

  try {
    $authParams = [ordered]@{
      client_id = $ClientId
      redirect_uri = $RedirectUri
      response_type = "code"
      scope = $chromeScope
      access_type = "offline"
      prompt = "consent"
    }

    $query = ($authParams.GetEnumerator() | ForEach-Object {
      "$([Uri]::EscapeDataString($_.Key))=$([Uri]::EscapeDataString($_.Value))"
    }) -join "&"

    $authUrl = "https://accounts.google.com/o/oauth2/v2/auth?$query"
    Write-Host ""
    Write-Host "Opening Google approval page..."
    Start-Process $authUrl

    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = [IO.StreamReader]::new($stream)
    $writer = [IO.StreamWriter]::new($stream)
    $writer.NewLine = "`r`n"
    $writer.AutoFlush = $true

    $requestLine = $reader.ReadLine()
    while ($reader.ReadLine()) {}

    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      throw "OAuth callback did not include an HTTP request."
    }

    $requestPath = $requestLine.Split(" ")[1]
    $callbackUri = [Uri]"http://127.0.0.1$requestPath"
    $callbackValues = ConvertFrom-QueryString -Query $callbackUri.Query

    if ($callbackValues.ContainsKey("error")) {
      $message = "Google returned an OAuth error: $($callbackValues["error"])"
      $writer.WriteLine("HTTP/1.1 400 Bad Request")
      $writer.WriteLine("Content-Type: text/html; charset=utf-8")
      $writer.WriteLine("")
      $writer.WriteLine("<h1>Chrome Web Store setup failed</h1><p>$message</p>")
      throw $message
    }

    $code = $callbackValues["code"]
    if ([string]::IsNullOrWhiteSpace($code)) {
      throw "OAuth callback did not include a code."
    }

    $writer.WriteLine("HTTP/1.1 200 OK")
    $writer.WriteLine("Content-Type: text/html; charset=utf-8")
    $writer.WriteLine("")
    $writer.WriteLine("<h1>Chrome Web Store setup complete</h1><p>You can close this tab and return to PowerShell.</p>")

    $client.Close()
    return $code
  } finally {
    $listener.Stop()
  }
}

if (-not (Test-CommandExists -Name "gh")) {
  throw "GitHub CLI is not installed or is not on PATH."
}

gh auth status | Out-Host

Write-Host ""
Write-Host "Before continuing, create an OAuth Client ID in Google Cloud:"
Write-Host "1. Open APIs & Services -> Credentials"
Write-Host "2. Create Credentials -> OAuth client ID"
Write-Host "3. Choose Desktop app"
Write-Host "4. Copy the Client ID and Client secret"
Write-Host ""

$publisherId = Read-PlainSecret -Name "CHROME_PUBLISHER_ID"
$extensionId = Read-PlainSecret -Name "CHROME_EXTENSION_ID"
$clientId = Read-PlainSecret -Name "CHROME_CLIENT_ID"
$clientSecret = Read-PlainSecret -Name "CHROME_CLIENT_SECRET"

$tempListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse("127.0.0.1"), 0)
$tempListener.Start()
$port = $tempListener.LocalEndpoint.Port
$tempListener.Stop()
$redirectUri = "http://127.0.0.1:$port/"

$code = Receive-OAuthCode -ClientId $clientId -RedirectUri $redirectUri

$tokenResponse = Invoke-RestMethod `
  -Method Post `
  -Uri "https://oauth2.googleapis.com/token" `
  -ContentType "application/x-www-form-urlencoded" `
  -Body @{
    code = $code
    client_id = $clientId
    client_secret = $clientSecret
    redirect_uri = $redirectUri
    grant_type = "authorization_code"
  }

if ([string]::IsNullOrWhiteSpace($tokenResponse.refresh_token)) {
  throw "Google did not return a refresh token. Re-run this script and make sure the consent screen is approved."
}

Set-GitHubSecret -Name "CHROME_PUBLISHER_ID" -Value $publisherId
Set-GitHubSecret -Name "CHROME_EXTENSION_ID" -Value $extensionId
Set-GitHubSecret -Name "CHROME_CLIENT_ID" -Value $clientId
Set-GitHubSecret -Name "CHROME_CLIENT_SECRET" -Value $clientSecret
Set-GitHubSecret -Name "CHROME_REFRESH_TOKEN" -Value $tokenResponse.refresh_token

Write-Host ""
Write-Host "Chrome Web Store GitHub secrets are set."
gh secret list
