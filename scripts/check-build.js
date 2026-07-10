const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const REQUIRED_FILES = [
  "sites.js",
  "background.js",
  "content.js",
  "popup.html",
  "popup.js",
  "icons/icon48.png",
  "icons/icon128.png",
  "manifest.json"
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function checkTarget(target, errors) {
  const targetDir = path.join(DIST_DIR, target);
  for (const relativePath of REQUIRED_FILES) {
    assert(
      fs.existsSync(path.join(targetDir, relativePath)),
      `${target} build is missing ${relativePath}`,
      errors
    );
  }

  assert(
    !fs.existsSync(path.join(targetDir, "icons", "source-logo.jpg")),
    `${target} build contains the source logo`,
    errors
  );
}

function main() {
  const errors = [];
  const packageJson = readJson(path.join(ROOT_DIR, "package.json"));
  const packageLock = readJson(path.join(ROOT_DIR, "package-lock.json"));
  const sourceManifest = readJson(path.join(ROOT_DIR, "manifest.json"));
  const chromeManifest = readJson(path.join(DIST_DIR, "chrome", "manifest.json"));
  const firefoxManifest = readJson(path.join(DIST_DIR, "firefox", "manifest.json"));

  checkTarget("chrome", errors);
  checkTarget("firefox", errors);

  assert(
    packageJson.version === sourceManifest.version &&
      packageLock.version === sourceManifest.version &&
      packageLock.packages?.[""]?.version === sourceManifest.version,
    "Package and manifest versions do not match",
    errors
  );
  assert(
    chromeManifest.version === sourceManifest.version &&
      firefoxManifest.version === sourceManifest.version,
    "Built manifest versions do not match the source manifest",
    errors
  );
  assert(
    chromeManifest.background?.service_worker === "background.js" &&
      !chromeManifest.background?.scripts,
    "Chrome build has an invalid background configuration",
    errors
  );
  assert(
    Array.isArray(firefoxManifest.background?.scripts) &&
      firefoxManifest.background.scripts.join(",") === "sites.js,background.js" &&
      !firefoxManifest.background?.service_worker,
    "Firefox build has an invalid background configuration",
    errors
  );
  assert(
    !chromeManifest.browser_specific_settings,
    "Chrome build contains Firefox-only browser settings",
    errors
  );
  assert(
    firefoxManifest.browser_specific_settings?.gecko?.id ===
      sourceManifest.browser_specific_settings?.gecko?.id,
    "Firefox build is missing the published add-on ID",
    errors
  );

  for (const zipName of [
    "VolumeNormalizer-Chrome.zip",
    "VolumeNormalizer-Firefox.zip"
  ]) {
    const zipPath = path.join(DIST_DIR, zipName);
    assert(
      fs.existsSync(zipPath) && fs.statSync(zipPath).size > 0,
      `${zipName} was not created`,
      errors
    );
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Checked Chrome and Firefox build outputs for ${sourceManifest.version}`);
}

main();
