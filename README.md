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

- `content.js`: Applies and re-applies normalized volume on media elements
- `popup.html`: Extension popup UI
- `popup.js`: Popup behavior and settings persistence
- `manifest.json`: Chromium MV3 manifest
- `manifest-firefox.json`: Firefox MV3 manifest (root variant)
- `firefox/`: Firefox package variant
- `firefox_fixed/`: Firefox package variant with additional metadata

## Installation (Chrome/Brave/Edge)

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable Developer Mode.
3. Click `Load unpacked`.
4. Select this project folder.

## Installation (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click `Load Temporary Add-on`.
3. Select one of the Firefox manifest files from this project.

## Development Notes

- Settings are stored in `chrome.storage.sync`.
- Content script uses exact domain/subdomain matching (no loose substring matching).
- Popup writes are debounced to reduce sync write pressure while dragging the slider.

## License

MIT
