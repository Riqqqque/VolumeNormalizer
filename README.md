# Volume Normalizer

Browser extension that normalizes video/audio element volume on selected high-noise websites.

## Features

- Automatic volume normalization on supported websites
- Adjustable global target volume (0-100)
- Quick volume presets and mouse-wheel adjustment
- Per-site enable/disable toggles
- Enable or disable all supported sites at once
- Persistent settings using browser sync storage
- Embedded-player support for related frames and open shadow roots
- Time-sliced media discovery for busy feeds
- Hidden-tab timer suspension to avoid unnecessary background wakeups
- Compact popup with reduced-motion support and native toolbar icon sizes

## Supported Sites

- X / Twitter
- Bluesky
- TikTok
- Instagram
- Facebook
- YouTube
- Twitch
- Reddit
- Dailymotion
- Vimeo
- Streamable
- Rumble
- Kick
- JW Player
- Brightcove
- Snapchat
- Pinterest
- Tumblr
- LinkedIn

## Project Structure

- `sites.js`: Shared supported-site catalog
- `background.js`: Persists settings outside the popup lifecycle
- `content.js`: Applies and re-applies normalized volume on media elements
- `popup.html`: Extension popup UI
- `popup.js`: Popup behavior and settings persistence
- `manifest.json`: Cross-browser MV3 source manifest
- `scripts/build.js`: Produces Chrome and Firefox build outputs and store ZIP files in `dist/`
- `scripts/test-runtime.js`: Exercises media discovery, shadow roots, settings, and timer behavior
- `scripts/preview-popup.js`: Serves the popup with a local browser API mock for UI review
- `package.json`: Build and validation scripts

## Build

1. Run `npm install`.
2. Run `npm run build`.
3. Use `dist/chrome/` for Chromium browsers and `dist/firefox/` for Firefox.

## Installation (Chrome/Brave/Edge)

1. Run `npm install`.
2. Run `npm run build`.
3. Open `chrome://extensions` (or `brave://extensions`).
4. Enable Developer Mode.
5. Click `Load unpacked`.
6. Select `dist/chrome/`.

## Installation (Firefox)

1. Run `npm install`.
2. Run `npm run build`.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click `Load Temporary Add-on`.
5. Select `dist/firefox/manifest.json`.

## Validation

- `npm run check`: Builds both targets, validates site/build consistency, checks script syntax, and runs Firefox linting.
- `npm run preview`: Starts the popup preview server at `http://127.0.0.1:4173`.
- `npm run test:runtime`: Runs the isolated content-script behavior and stress smoke test.

## Development Notes

- Settings are stored in `chrome.storage.sync`.
- Content script uses exact domain/subdomain matching (no loose substring matching).
- Large DOM updates are scanned in short idle-time slices instead of blocking the page.
- Hidden tabs stop periodic fallback checks and resume them when visible.
- Popup writes are proxied through the background script so final saves survive popup teardown.
- Build output strips BOMs and generates browser-specific manifests from the root source manifest.

## License

MIT
