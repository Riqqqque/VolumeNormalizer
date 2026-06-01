const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8"));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(
    path.join(ROOT_DIR, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8"
  );
}

function getNextPatchVersion(version) {
  const parts = version.split(".").map((part) => Number(part));
  parts[2] += 1;
  return parts.join(".");
}

function main() {
  const packageJson = readJson("package.json");
  const manifest = readJson("manifest.json");
  const packageLock = readJson("package-lock.json");
  const requestedVersion = process.argv[2];
  const nextVersion = requestedVersion || getNextPatchVersion(packageJson.version);

  if (!VERSION_PATTERN.test(nextVersion)) {
    throw new Error(`Expected a version like 2.0.7, got "${nextVersion}"`);
  }

  packageJson.version = nextVersion;
  manifest.version = nextVersion;
  packageLock.version = nextVersion;

  if (packageLock.packages && packageLock.packages[""]) {
    packageLock.packages[""].version = nextVersion;
  }

  writeJson("package.json", packageJson);
  writeJson("manifest.json", manifest);
  writeJson("package-lock.json", packageLock);

  console.log(`Version set to ${nextVersion}`);
}

main();
