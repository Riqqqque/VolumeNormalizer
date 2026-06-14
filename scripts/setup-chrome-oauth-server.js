const http = require("http");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const HOST = "127.0.0.1";
const CHROME_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const setupToken = crypto.randomBytes(18).toString("hex");
const state = crypto.randomBytes(18).toString("hex");

let chromeValues = null;
let server;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openUrl(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

function sendHtml(response, statusCode, title, content) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #101225;
      --panel: #1b1f3f;
      --line: rgba(255,255,255,.14);
      --text: #f6f7ff;
      --muted: rgba(236,240,255,.72);
      --cyan: #00d4ff;
      --violet: #7b2cbf;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 28px;
      background:
        radial-gradient(circle at top left, rgba(0,212,255,.22), transparent 34%),
        radial-gradient(circle at 90% 10%, rgba(123,44,191,.3), transparent 30%),
        var(--bg);
      color: var(--text);
      font-family: "Segoe UI", sans-serif;
    }
    main {
      width: min(760px, 100%);
      padding: 26px;
      border: 1px solid var(--line);
      border-radius: 22px;
      background: rgba(27,31,63,.9);
      box-shadow: 0 24px 60px rgba(0,0,0,.35);
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { color: var(--muted); line-height: 1.5; }
    a { color: #80e8ff; }
    label { display: block; margin-top: 16px; font-weight: 700; }
    input {
      width: 100%;
      margin-top: 7px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      background: rgba(255,255,255,.08);
      color: var(--text);
      font-size: 15px;
    }
    button {
      margin-top: 22px;
      padding: 12px 18px;
      border: 0;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--cyan), var(--violet));
      color: white;
      font-weight: 800;
      cursor: pointer;
    }
    .note {
      padding: 13px 14px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: rgba(255,255,255,.06);
    }
  </style>
</head>
<body><main>${content}</main></body>
</html>`);
}

function sendSetupPage(response, error = "") {
  const errorHtml = error
    ? `<p class="note" style="color:#ffb4b4">${escapeHtml(error)}</p>`
    : "";

  sendHtml(
    response,
    200,
    "Chrome Web Store Setup",
    `<h1>Chrome Web Store setup</h1>
    <p>This page stays on your PC. It sends the values straight to GitHub Secrets and does not write them into the repo.</p>
    <p class="note">If you have not made the OAuth client yet: open <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud credentials</a>, click <strong>Create credentials</strong>, choose <strong>OAuth client ID</strong>, then choose <strong>Desktop app</strong>.</p>
    <p class="note">Open the <a href="https://chrome.google.com/webstore/devconsole/" target="_blank">Chrome Web Store dashboard</a> for the publisher ID and extension ID. If the item does not exist yet, create/upload it once in the dashboard first.</p>
    ${errorHtml}
    <form method="post" action="/start">
      <input type="hidden" name="setupToken" value="${setupToken}">
      <label>CHROME_PUBLISHER_ID
        <input name="publisherId" autocomplete="off" required>
      </label>
      <label>CHROME_EXTENSION_ID
        <input name="extensionId" autocomplete="off" required>
      </label>
      <label>CHROME_CLIENT_ID
        <input name="clientId" autocomplete="off" required>
      </label>
      <label>CHROME_CLIENT_SECRET
        <input name="clientSecret" type="password" autocomplete="off" required>
      </label>
      <button type="submit">Approve Google and save secrets</button>
    </form>`
  );
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        request.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function requireField(fields, name) {
  const value = fields.get(name);
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${name}`);
  }
  return String(value).trim();
}

function verifySetupToken(fields) {
  if (fields.get("setupToken") !== setupToken) {
    throw new Error("Setup form token did not match. Reload the local setup page and try again.");
  }
}

function setGitHubSecret(name, value) {
  const result = spawnSync("gh", ["secret", "set", name], {
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"]
  });

  if (result.status !== 0) {
    throw new Error(`Failed to save ${name}: ${result.stderr || result.stdout}`);
  }
}

async function exchangeCodeForRefreshToken(code, redirectUri) {
  const body = new URLSearchParams({
    code,
    client_id: chromeValues.clientId,
    client_secret: chromeValues.clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload.error_description || payload.error || response.statusText;
    throw new Error(`Google token exchange failed: ${detail}`);
  }

  if (!payload.refresh_token) {
    throw new Error("Google did not return a refresh token. Start again and approve the consent screen.");
  }

  return payload.refresh_token;
}

async function handleStart(request, response, baseUrl) {
  const body = await readRequestBody(request);
  const fields = new URLSearchParams(body);
  verifySetupToken(fields);

  chromeValues = {
    publisherId: requireField(fields, "publisherId"),
    extensionId: requireField(fields, "extensionId"),
    clientId: requireField(fields, "clientId"),
    clientSecret: requireField(fields, "clientSecret")
  };

  const redirectUri = `${baseUrl}/oauth-callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", chromeValues.clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", CHROME_SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  response.writeHead(302, { Location: authUrl.toString() });
  response.end();
}

async function handleOAuthCallback(request, response, baseUrl) {
  if (!chromeValues) {
    sendSetupPage(response, "Setup values were missing. Fill out the form again.");
    return;
  }

  const url = new URL(request.url, baseUrl);
  const error = url.searchParams.get("error");
  if (error) {
    throw new Error(`Google returned an OAuth error: ${error}`);
  }

  if (url.searchParams.get("state") !== state) {
    throw new Error("OAuth state did not match. Start again from the setup form.");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error("Google did not return an OAuth code.");
  }

  const refreshToken = await exchangeCodeForRefreshToken(code, `${baseUrl}/oauth-callback`);

  setGitHubSecret("CHROME_PUBLISHER_ID", chromeValues.publisherId);
  setGitHubSecret("CHROME_EXTENSION_ID", chromeValues.extensionId);
  setGitHubSecret("CHROME_CLIENT_ID", chromeValues.clientId);
  setGitHubSecret("CHROME_CLIENT_SECRET", chromeValues.clientSecret);
  setGitHubSecret("CHROME_REFRESH_TOKEN", refreshToken);

  sendHtml(
    response,
    200,
    "Chrome Setup Complete",
    `<h1>Chrome setup complete</h1>
    <p>Chrome Web Store secrets were saved to GitHub Actions. You can close this tab and tell me <strong>done</strong>.</p>`
  );

  setTimeout(() => server.close(), 1500);
}

server = http.createServer(async (request, response) => {
  const baseUrl = `http://${HOST}:${server.address().port}`;

  try {
    if (request.method === "GET" && request.url === "/") {
      sendSetupPage(response);
      return;
    }

    if (request.method === "POST" && request.url === "/start") {
      await handleStart(request, response, baseUrl);
      return;
    }

    if (request.method === "GET" && request.url.startsWith("/oauth-callback")) {
      await handleOAuthCallback(request, response, baseUrl);
      return;
    }

    sendHtml(response, 404, "Not Found", "<h1>Not found</h1>");
  } catch (error) {
    sendHtml(
      response,
      500,
      "Chrome Setup Error",
      `<h1>Chrome setup error</h1>
      <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      <p><a href="/">Back to setup</a></p>`
    );
  }
});

server.listen(0, HOST, () => {
  const url = `http://${HOST}:${server.address().port}`;
  console.log(`Chrome setup server running at ${url}`);
  openUrl(url);
});
