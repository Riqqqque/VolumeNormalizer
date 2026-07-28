const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 4173);
const HOST = "127.0.0.1";
const MOCK_BROWSER_API = `
<script>
  globalThis.chrome = {
    runtime: {
      lastError: null,
      getManifest: () => ({ version: "preview" }),
      sendMessage: (message, callback) => {
        if (message.type === "get-settings") {
          callback({ ok: true, settings: { volume: 25, enabledSites: {} } });
          return;
        }
        callback({ ok: true });
      }
    },
    storage: {
      sync: {
        get: (defaults, callback) => callback(defaults),
        set: (_patch, callback) => callback()
      }
    }
  };
</script>`;

function sendFile(response, relativePath, contentType) {
  const body = fs.readFileSync(path.join(ROOT_DIR, relativePath));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${HOST}:${PORT}`);

  if (url.pathname === "/" || url.pathname === "/popup.html") {
    const popupHtml = fs
      .readFileSync(path.join(ROOT_DIR, "popup.html"), "utf8")
      .replace('<script src="sites.js"></script>', `${MOCK_BROWSER_API}\n  <script src="sites.js"></script>`);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(popupHtml);
    return;
  }

  if (url.pathname === "/sites.js") {
    sendFile(response, "sites.js", "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/popup.js") {
    sendFile(response, "popup.js", "text/javascript; charset=utf-8");
    return;
  }

  response.writeHead(404);
  response.end("Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`Popup preview: http://${HOST}:${PORT}`);
});
