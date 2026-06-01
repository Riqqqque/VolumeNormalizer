$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$chromeScope = "https://www.googleapis.com/auth/chromewebstore"

function Show-Message {
  param(
    [string]$Title,
    [string]$Message,
    [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
  )

  [System.Windows.Forms.MessageBox]::Show(
    $Message,
    $Title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $Icon
  ) | Out-Null
}

function Read-GuiValue {
  param(
    [string]$Name,
    [string]$HelpText,
    [bool]$Secret = $true
  )

  $form = [System.Windows.Forms.Form]::new()
  $form.Text = "Volume Normalizer Store Setup"
  $form.Width = 560
  $form.Height = 220
  $form.StartPosition = "CenterScreen"
  $form.TopMost = $true
  $form.FormBorderStyle = "FixedDialog"
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false

  $label = [System.Windows.Forms.Label]::new()
  $label.Text = "$Name`r`n$HelpText"
  $label.AutoSize = $false
  $label.Width = 500
  $label.Height = 70
  $label.Left = 20
  $label.Top = 20

  $textBox = [System.Windows.Forms.TextBox]::new()
  $textBox.Width = 500
  $textBox.Left = 20
  $textBox.Top = 92
  if ($Secret) {
    $textBox.UseSystemPasswordChar = $true
  }

  $okButton = [System.Windows.Forms.Button]::new()
  $okButton.Text = "OK"
  $okButton.Left = 344
  $okButton.Top = 132
  $okButton.Width = 80
  $okButton.DialogResult = [System.Windows.Forms.DialogResult]::OK

  $cancelButton = [System.Windows.Forms.Button]::new()
  $cancelButton.Text = "Cancel"
  $cancelButton.Left = 440
  $cancelButton.Top = 132
  $cancelButton.Width = 80
  $cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.Controls.AddRange(@($label, $textBox, $okButton, $cancelButton))
  $form.AcceptButton = $okButton
  $form.CancelButton = $cancelButton

  $result = $form.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    throw "Setup cancelled."
  }

  $value = $textBox.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is required."
  }

  return $value
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

function Set-GitHubSecret {
  param(
    [string]$Name,
    [string]$Value
  )

  $Value | gh secret set $Name
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
    Start-Process $authUrl

    Show-Message `
      -Title "Approve Google Access" `
      -Message "A Google approval page opened. Pick your developer account and approve Chrome Web Store access. This helper will continue after the browser redirects back to 127.0.0.1."

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
    $writer.WriteLine("<h1>Chrome Web Store setup complete</h1><p>You can close this tab.</p>")

    $client.Close()
    return $code
  } finally {
    $listener.Stop()
  }
}

try {
  gh auth status | Out-Null

  Start-Process "https://console.cloud.google.com/apis/credentials"
  Start-Process "https://chrome.google.com/webstore/devconsole/"

  Show-Message `
    -Title "Chrome Setup" `
    -Message "Create a Google Cloud OAuth client if you have not already: APIs & Services -> Credentials -> Create Credentials -> OAuth client ID -> Desktop app. Also open your Chrome Web Store item so you can copy the publisher ID and extension ID."

  $publisherId = Read-GuiValue `
    -Name "CHROME_PUBLISHER_ID" `
    -HelpText "Chrome Web Store publisher ID from the developer dashboard." `
    -Secret $false

  $extensionId = Read-GuiValue `
    -Name "CHROME_EXTENSION_ID" `
    -HelpText "The Chrome Web Store item/extension ID." `
    -Secret $false

  $clientId = Read-GuiValue `
    -Name "CHROME_CLIENT_ID" `
    -HelpText "Google Cloud OAuth Desktop app Client ID." `
    -Secret $false

  $clientSecret = Read-GuiValue `
    -Name "CHROME_CLIENT_SECRET" `
    -HelpText "Google Cloud OAuth Desktop app Client secret." `
    -Secret $true

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
    throw "Google did not return a refresh token. Re-run this helper and approve the consent screen."
  }

  Set-GitHubSecret -Name "CHROME_PUBLISHER_ID" -Value $publisherId
  Set-GitHubSecret -Name "CHROME_EXTENSION_ID" -Value $extensionId
  Set-GitHubSecret -Name "CHROME_CLIENT_ID" -Value $clientId
  Set-GitHubSecret -Name "CHROME_CLIENT_SECRET" -Value $clientSecret
  Set-GitHubSecret -Name "CHROME_REFRESH_TOKEN" -Value $tokenResponse.refresh_token

  Show-Message `
    -Title "Chrome Setup Complete" `
    -Message "Chrome Web Store secrets were saved to GitHub Actions."
} catch {
  Show-Message `
    -Title "Chrome Setup Failed" `
    -Message ($_.Exception.Message) `
    -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
  throw
}
