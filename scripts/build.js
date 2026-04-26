const fs = require("fs");
const path = require("path");
const yazl = require("yazl");

const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist");
const CHROME_DIR = path.join(DIST_DIR, "chrome");
const FIREFOX_DIR = path.join(DIST_DIR, "firefox");
const SOURCE_FILES = ["background.js", "content.js", "popup.html", "popup.js"];
const ICON_EXTENSIONS = new Set([".png", ".svg"]);

function readJson(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function ensureCleanDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(relativePath, targetDir) {
  const sourcePath = path.join(ROOT_DIR, relativePath);
  const targetPath = path.join(targetDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function copyIcons(targetDir) {
  const sourceDir = path.join(ROOT_DIR, "icons");
  const targetIconsDir = path.join(targetDir, "icons");
  fs.mkdirSync(targetIconsDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!ICON_EXTENSIONS.has(extension)) {
      continue;
    }

    fs.copyFileSync(
      path.join(sourceDir, entry.name),
      path.join(targetIconsDir, entry.name)
    );
  }
}

function buildChromeManifest(baseManifest) {
  const manifest = cloneJson(baseManifest);
  delete manifest.browser_specific_settings;
  manifest.background = {
    service_worker: "background.js"
  };
  return manifest;
}

function buildFirefoxManifest(baseManifest) {
  const manifest = cloneJson(baseManifest);
  manifest.background = {
    scripts: ["background.js"]
  };
  return manifest;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function listFiles(dirPath, baseDir = dirPath) {
  const files = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const absolutePath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(absolutePath, baseDir));
      continue;
    }

    const relativePath = path.relative(baseDir, absolutePath).split(path.sep).join("/");
    files.push({
      absolutePath,
      relativePath
    });
  }

  return files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
}

function createZip(targetDir, zipFileName) {
  const destinationPath = path.join(DIST_DIR, zipFileName);
  fs.rmSync(destinationPath, { force: true });

  const zipFile = new yazl.ZipFile();
  const output = fs.createWriteStream(destinationPath);

  listFiles(targetDir).forEach((file) => {
    zipFile.addFile(file.absolutePath, file.relativePath);
  });

  return new Promise((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
    zipFile.outputStream.on("error", reject);
    zipFile.outputStream.pipe(output);
    zipFile.end();
  });
}

function buildTarget(targetDir, manifest) {
  ensureCleanDir(targetDir);

  SOURCE_FILES.forEach((file) => {
    copyFile(file, targetDir);
  });

  copyIcons(targetDir);
  writeJson(path.join(targetDir, "manifest.json"), manifest);
}

async function main() {
  const baseManifest = readJson(path.join(ROOT_DIR, "manifest.json"));
  const packageJson = readJson(path.join(ROOT_DIR, "package.json"));

  if (packageJson.version !== baseManifest.version) {
    throw new Error(
      `package.json version ${packageJson.version} does not match manifest version ${baseManifest.version}`
    );
  }

  ensureCleanDir(DIST_DIR);
  buildTarget(CHROME_DIR, buildChromeManifest(baseManifest));
  buildTarget(FIREFOX_DIR, buildFirefoxManifest(baseManifest));

  await createZip(CHROME_DIR, "VolumeNormalizer-Chrome.zip");
  await createZip(FIREFOX_DIR, "VolumeNormalizer-Firefox.zip");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
