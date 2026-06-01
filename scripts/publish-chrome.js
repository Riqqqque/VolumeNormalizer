const fs = require("fs");
const path = require("path");

const DEFAULT_ZIP_PATH = path.resolve(
  __dirname,
  "..",
  "dist",
  "VolumeNormalizer-Chrome.zip"
);
const UPLOAD_POLL_DELAY_MS = Number(process.env.CHROME_UPLOAD_POLL_DELAY_MS || 5000);
const UPLOAD_POLL_ATTEMPTS = Number(process.env.CHROME_UPLOAD_POLL_ATTEMPTS || 24);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = payload.error?.message || payload.raw || response.statusText;
    throw new Error(`${response.status} ${response.statusText}: ${detail}`);
  }

  return payload;
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: requireEnv("CHROME_CLIENT_ID"),
    client_secret: requireEnv("CHROME_CLIENT_SECRET"),
    refresh_token: requireEnv("CHROME_REFRESH_TOKEN"),
    grant_type: "refresh_token"
  });

  const payload = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!payload.access_token) {
    throw new Error("Chrome token response did not include an access token");
  }

  return payload.access_token;
}

function getItemName() {
  const publisherId = requireEnv("CHROME_PUBLISHER_ID");
  const extensionId = requireEnv("CHROME_EXTENSION_ID");
  return `publishers/${publisherId}/items/${extensionId}`;
}

function getUploadState(payload) {
  return (
    payload.uploadState ||
    payload.lastAsyncUploadState ||
    payload.item?.uploadState ||
    payload.status?.uploadState ||
    payload.status?.lastAsyncUploadState ||
    ""
  );
}

function isFailedUploadState(uploadState) {
  return uploadState === "FAILED" || uploadState === "FAILURE" || uploadState === "UPLOAD_FAILED";
}

function isInProgressUploadState(uploadState) {
  return uploadState === "IN_PROGRESS" || uploadState === "UPLOAD_IN_PROGRESS";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function uploadPackage(accessToken, zipPath) {
  const itemName = getItemName();
  const uploadUrl = `https://chromewebstore.googleapis.com/upload/v2/${itemName}:upload`;
  const zipBuffer = fs.readFileSync(zipPath);

  const payload = await requestJson(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/zip"
    },
    body: zipBuffer
  });

  if (isFailedUploadState(getUploadState(payload))) {
    throw new Error(`Chrome upload failed: ${JSON.stringify(payload)}`);
  }

  console.log(`Chrome upload state: ${getUploadState(payload) || "accepted"}`);
  return payload;
}

async function fetchStatus(accessToken) {
  const itemName = getItemName();
  const statusUrl = `https://chromewebstore.googleapis.com/v2/${itemName}:fetchStatus`;
  return requestJson(statusUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}

async function waitForUpload(accessToken, uploadPayload) {
  let statusPayload = uploadPayload;

  for (let attempt = 0; attempt <= UPLOAD_POLL_ATTEMPTS; attempt += 1) {
    const uploadState = getUploadState(statusPayload);

    if (isFailedUploadState(uploadState)) {
      throw new Error(`Chrome upload failed: ${JSON.stringify(statusPayload)}`);
    }

    if (!isInProgressUploadState(uploadState)) {
      return statusPayload;
    }

    if (attempt === UPLOAD_POLL_ATTEMPTS) {
      throw new Error("Chrome upload did not finish before the polling timeout");
    }

    console.log("Chrome upload is still processing; checking again...");
    await sleep(UPLOAD_POLL_DELAY_MS);
    statusPayload = await fetchStatus(accessToken);
  }

  return statusPayload;
}

async function publishPackage(accessToken) {
  const itemName = getItemName();
  const publishUrl = `https://chromewebstore.googleapis.com/v2/${itemName}:publish`;
  const payload = await requestJson(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  console.log(`Chrome publish response: ${JSON.stringify(payload)}`);
}

async function main() {
  const zipPath = path.resolve(process.argv[2] || DEFAULT_ZIP_PATH);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`Chrome package not found: ${zipPath}`);
  }

  const accessToken = await getAccessToken();
  const uploadPayload = await uploadPackage(accessToken, zipPath);
  await waitForUpload(accessToken, uploadPayload);

  if (process.env.CHROME_SKIP_PUBLISH === "true") {
    console.log("Chrome publish skipped because CHROME_SKIP_PUBLISH=true");
    return;
  }

  await publishPackage(accessToken);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
