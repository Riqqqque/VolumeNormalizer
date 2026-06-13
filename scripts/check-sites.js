const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SITES = [
  { id: "x", domains: ["twitter.com", "x.com"], displayName: "X / Twitter" },
  { id: "bluesky", domains: ["bsky.app"], displayName: "Bluesky" },
  { id: "tiktok", domains: ["tiktok.com"], displayName: "TikTok" },
  { id: "instagram", domains: ["instagram.com"], displayName: "Instagram" },
  { id: "facebook", domains: ["facebook.com"], displayName: "Facebook" },
  { id: "youtube", domains: ["youtube.com"], displayName: "YouTube" },
  { id: "twitch", domains: ["twitch.tv"], displayName: "Twitch" },
  { id: "reddit", domains: ["reddit.com"], displayName: "Reddit" },
  { id: "dailymotion", domains: ["dailymotion.com"], displayName: "Dailymotion" },
  { id: "vimeo", domains: ["vimeo.com"], displayName: "Vimeo" },
  { id: "snapchat", domains: ["snapchat.com"], displayName: "Snapchat" },
  { id: "pinterest", domains: ["pinterest.com"], displayName: "Pinterest" },
  { id: "tumblr", domains: ["tumblr.com"], displayName: "Tumblr" },
  { id: "linkedin", domains: ["linkedin.com"], displayName: "LinkedIn" }
];

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function assertIncludes(sourceName, sourceText, expectedText, errors) {
  if (!sourceText.includes(expectedText)) {
    errors.push(`${sourceName} is missing ${expectedText}`);
  }
}

function main() {
  const errors = [];
  const contentScript = readText("content.js");
  const backgroundScript = readText("background.js");
  const popupScript = readText("popup.js");
  const readme = readText("README.md");
  const manifest = readJson("manifest.json");
  const matches = new Set(manifest.content_scripts?.[0]?.matches || []);

  for (const site of SITES) {
    assertIncludes("content.js", contentScript, `${site.id}:`, errors);
    assertIncludes("background.js", backgroundScript, `"${site.id}"`, errors);
    assertIncludes("popup.js", popupScript, `id: "${site.id}"`, errors);
    assertIncludes("README.md", readme, site.displayName, errors);

    for (const domain of site.domains) {
      assertIncludes("content.js", contentScript, `"${domain}"`, errors);
      if (!matches.has(`*://${domain}/*`)) {
        errors.push(`manifest.json is missing *://${domain}/*`);
      }
      if (!matches.has(`*://*.${domain}/*`)) {
        errors.push(`manifest.json is missing *://*.${domain}/*`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }

  console.log(`Checked ${SITES.length} supported sites`);
}

main();
