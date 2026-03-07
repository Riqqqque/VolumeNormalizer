# Share Instantly (Without Store Review Delay)

Store review can take time. For immediate sharing, users can install the extension in developer mode.

Build the extension first with `npm install` and `npm run build`.

## What to Share

- Chromium browsers: `dist/VolumeNormalizer-Chrome.zip`
- Firefox: `dist/VolumeNormalizer-Firefox.zip`

## Chromium Install (Chrome/Brave/Edge)

1. Extract the zip to a local folder.
2. Open the browser extensions page:
- Brave: `brave://extensions`
- Chrome: `chrome://extensions`
- Edge: `edge://extensions`
3. Enable Developer Mode.
4. Click `Load unpacked`.
5. Select the extracted folder.

## Firefox Install

1. Extract the Firefox zip to a local folder.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click `Load Temporary Add-on`.
4. Select the extracted `manifest.json` file.

Note: Temporary Firefox add-ons are removed when Firefox closes unless distributed through standard signing/publication.
