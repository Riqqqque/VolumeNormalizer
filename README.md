# Volume Normalizer

Browser extension that normalizes video/audio element volume on selected high-noise websites.

## Features

- Automatic volume normalization on supported websites
- Adjustable global target volume (0-100)
- Per-site enable/disable toggles
- Persistent settings using browser sync storage
- Works with dynamic page updates via MutationObserver

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
- Snapchat
- Pinterest
- Tumblr
- LinkedIn

## Project Structure

- `background.js`: Persists settings outside the popup lifecycle
- `content.js`: Applies and re-applies normalized volume on media elements
- `popup.html`: Extension popup UI
- `popup.js`: Popup behavior and settings persistence
- `manifest.json`: Cross-browser MV3 source manifest
- `scripts/build.js`: Produces Chrome and Firefox build outputs in `dist/`
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

- `npm run check`: Builds the extension and runs script syntax checks plus Firefox linting.

## Development Notes

- Settings are stored in `chrome.storage.sync`.
- Content script uses exact domain/subdomain matching (no loose substring matching).
- Popup writes are proxied through the background script so final saves survive popup teardown.
- Build output strips BOMs and generates browser-specific manifests from the root source manifest.

## License

MIT
