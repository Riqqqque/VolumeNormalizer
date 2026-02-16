# How to Publish the Extension

Brave is Chromium-based, so you can publish this extension to the Chrome Web Store.
That listing will also serve Chrome, Brave, Edge, and Opera users.

## Prerequisites

1. Google account
2. Chrome Web Store developer registration (one-time fee)
3. Upload package (`.zip`) for the extension

## Publish Steps

1. Open the Chrome Web Store Developer Dashboard.
2. Create a new item and upload the extension zip.
3. Complete listing metadata:
- Description
- Category
- Language
- Screenshots
- Promotional assets (if requested)
4. Complete privacy section:
- Explain that only `storage` is used
- Clarify data collection behavior
5. Submit for review.

## Updating

1. Increment `version` in the manifest.
2. Build a new zip package.
3. Upload the new package in the existing listing.
