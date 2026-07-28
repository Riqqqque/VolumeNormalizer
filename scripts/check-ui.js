const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const ICON_SIZES = [16, 32, 48, 128];
const REQUIRED_POPUP_IDS = [
  "enabledSitesValue",
  "volumeInput",
  "volumeSlider",
  "volumeTone",
  "presetButtons",
  "sitesList",
  "sitesTotalValue",
  "enableAllButton",
  "disableAllButton",
  "saveStatus",
  "versionValue"
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function readPngDimensions(relativePath) {
  const buffer = fs.readFileSync(path.join(ROOT_DIR, relativePath));
  const pngSignature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function main() {
  const errors = [];
  const popupHtml = readText("popup.html");
  const contentScript = readText("content.js");
  const manifest = readJson("manifest.json");

  for (const id of REQUIRED_POPUP_IDS) {
    if (!popupHtml.includes(`id="${id}"`)) {
      errors.push(`popup.html is missing #${id}`);
    }
  }

  if (/<img\b/i.test(popupHtml)) {
    errors.push("popup.html must not repeat the extension icon");
  }
  if (/backdrop-filter/i.test(popupHtml)) {
    errors.push("popup.html must not use backdrop-filter");
  }
  if (!popupHtml.includes("prefers-reduced-motion")) {
    errors.push("popup.html is missing reduced-motion support");
  }
  if (!popupHtml.includes("contain: layout paint")) {
    errors.push("popup.html is missing containment for the site grid");
  }
  if (contentScript.includes("setInterval(")) {
    errors.push("content.js must not poll hidden tabs with setInterval");
  }
  if (!contentScript.includes('document.visibilityState === "visible"')) {
    errors.push("content.js is missing visibility-aware fallback checks");
  }

  for (const size of ICON_SIZES) {
    const relativePath = `icons/icon${size}.png`;
    const dimensions = readPngDimensions(relativePath);
    if (!dimensions || dimensions.width !== size || dimensions.height !== size) {
      errors.push(`${relativePath} must be a ${size}x${size} PNG`);
    }
    if (manifest.icons?.[size] !== relativePath) {
      errors.push(`manifest.json is missing the ${size}px extension icon`);
    }
    if (manifest.action?.default_icon?.[size] !== relativePath) {
      errors.push(`manifest.json is missing the ${size}px action icon`);
    }
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log("Checked popup performance rules and icon assets");
}

main();
