const fs = require("fs");
const path = require("path");
const SITES = require("../sites.js");

const ROOT_DIR = path.resolve(__dirname, "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function main() {
  const errors = [];
  const ids = new Set();
  const domains = new Set();
  const popupScript = readText("popup.js");
  const popupHtml = readText("popup.html");
  const readme = readText("README.md");
  const manifest = readJson("manifest.json");
  const contentScriptDefinition = manifest.content_scripts?.[0] || {};
  const matches = new Set(contentScriptDefinition.matches || []);

  for (const site of SITES) {
    if (ids.has(site.id)) {
      errors.push(`sites.js has duplicate site ID ${site.id}`);
    }
    ids.add(site.id);

    if (!popupScript.includes("VOLUME_NORMALIZER_SITES")) {
      errors.push("popup.js does not use the shared site catalog");
    }
    if (!readme.includes(site.name)) {
      errors.push(`README.md is missing ${site.name}`);
    }

    for (const domain of site.domains) {
      if (domains.has(domain)) {
        errors.push(`sites.js has duplicate domain ${domain}`);
      }
      domains.add(domain);

      if (!matches.has(`*://${domain}/*`)) {
        errors.push(`manifest.json is missing *://${domain}/*`);
      }
      if (!matches.has(`*://*.${domain}/*`)) {
        errors.push(`manifest.json is missing *://*.${domain}/*`);
      }
    }
  }

  if (matches.size !== domains.size * 2) {
    errors.push(
      `manifest.json has ${matches.size} matches; expected ${domains.size * 2}`
    );
  }
  if (contentScriptDefinition.all_frames !== true) {
    errors.push("manifest.json must enable all_frames for embedded players");
  }
  if (contentScriptDefinition.match_about_blank !== true) {
    errors.push("manifest.json must enable match_about_blank for related frames");
  }
  if (contentScriptDefinition.match_origin_as_fallback !== true) {
    errors.push("manifest.json must enable match_origin_as_fallback for related frames");
  }
  if (!popupHtml.includes(`${SITES.length}/${SITES.length}`)) {
    errors.push("popup.html has a stale enabled-site fallback count");
  }

  if (errors.length > 0) {
    console.error([...new Set(errors)].join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${SITES.length} supported sites and ${domains.size} domains`);
}

main();
