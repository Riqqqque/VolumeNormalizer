const http = require("http");
const { spawn, spawnSync } = require("child_process");

const HOST = "127.0.0.1";
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
    "Firefox Add-ons Setup",
    `<h1>Firefox Add-ons setup</h1>
    <p>This page stays on your PC. It saves the API credentials straight to GitHub Secrets and does not write them into the repo.</p>
    <p class="note">Open <a href="https://addons.mozilla.org/en-US/developers/addon/api/key/" target="_blank">Firefox Add-ons API credentials</a>, copy the JWT issuer and JWT secret, then paste them below.</p>
    ${errorHtml}
    <form method="post" action="/save">
      <label>WEB_EXT_API_KEY / JWT issuer
        <input name="apiKey" autocomplete="off" required>
      </label>
      <label>WEB_EXT_API_SECRET / JWT secret
        <input name="apiSecret" type="password" autocomplete="off" required>
      </label>
      <button type="submit">Save Firefox secrets</button>
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

async function handleSave(request, response) {
  const body = await readRequestBody(request);
  const fields = new URLSearchParams(body);

  setGitHubSecret("WEB_EXT_API_KEY", requireField(fields, "apiKey"));
  setGitHubSecret("WEB_EXT_API_SECRET", requireField(fields, "apiSecret"));

  sendHtml(
    response,
    200,
    "Firefox Setup Complete",
    `<h1>Firefox setup complete</h1>
    <p>Firefox Add-ons secrets were saved to GitHub Actions. You can close this tab and tell Codex <strong>done</strong>.</p>`
  );

  setTimeout(() => server.close(), 1500);
}

server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      sendSetupPage(response);
      return;
    }

    if (request.method === "POST" && request.url === "/save") {
      await handleSave(request, response);
      return;
    }

    sendHtml(response, 404, "Not Found", "<h1>Not found</h1>");
  } catch (error) {
    sendHtml(
      response,
      500,
      "Firefox Setup Error",
      `<h1>Firefox setup error</h1>
      <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      <p><a href="/">Back to setup</a></p>`
    );
  }
});

server.listen(0, HOST, () => {
  const url = `http://${HOST}:${server.address().port}`;
  console.log(`Firefox setup server running at ${url}`);
  openUrl(url);
});
