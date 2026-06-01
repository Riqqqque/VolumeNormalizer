# Publishing

Brave is Chromium-based, so you can publish this extension to the Chrome Web Store.
That listing will also serve Chrome, Brave, Edge, and Opera users.

Build the packages first with `npm ci` and `npm run check`.

## Normal Update Flow

1. Bump the extension version:

```powershell
npm run version:set -- 2.0.7
```

If no version is passed, the script bumps the patch version.

2. Build and validate:

```powershell
npm run check
```

3. Commit, tag, and push:

```powershell
git add manifest.json package.json package-lock.json
git commit -m "Release 2.0.7"
git tag v2.0.7
git push origin main v2.0.7
```

The `Extension Release` GitHub Actions workflow builds both store ZIP files for every `v*.*.*` tag.

## One-Time GitHub Secrets

Add these in GitHub: `Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`.

Or run the local helper and paste the values into its prompts:

```powershell
.\scripts\setup-release-secrets.ps1
```

Use `-FirefoxOnly` or `-ChromeOnly` if you want to set up one store at a time.

Firefox Add-ons:

```text
WEB_EXT_API_KEY
WEB_EXT_API_SECRET
```

These are the AMO JWT issuer and JWT secret from the Mozilla Add-ons developer credentials page.

Chrome Web Store:

```text
CHROME_PUBLISHER_ID
CHROME_EXTENSION_ID
CHROME_CLIENT_ID
CHROME_CLIENT_SECRET
CHROME_REFRESH_TOKEN
```

Chrome requires the Chrome Web Store API to be enabled in a Google Cloud project, an OAuth client, and a refresh token with the `https://www.googleapis.com/auth/chromewebstore` scope.

Keep these values only in GitHub Secrets or your local shell environment. Do not commit them.

After enabling the Chrome Web Store API, run this helper to create the OAuth approval URL, capture the callback locally, and save the Chrome secrets:

```powershell
npm run setup:chrome
```

Use a Google Cloud OAuth client with application type `Desktop app`.

## Publishing From GitHub Actions

After secrets are set, open the `Extension Release` workflow in GitHub Actions and click `Run workflow`.

Set:

```text
publish_chrome = true
publish_firefox = true
```

Chrome uploads `dist/VolumeNormalizer-Chrome.zip` and calls the Chrome Web Store publish endpoint. Firefox submits `dist/firefox` through `web-ext sign --channel listed`.

You can also start the workflow from the terminal:

```powershell
.\scripts\run-release-workflow.ps1
```

Use `-Chrome` or `-Firefox` to publish only one store.

## Local Publishing

Local Chrome publish, after setting the Chrome environment variables:

```powershell
npm run build
npm run publish:chrome
```

Local Firefox publish, after setting `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`:

```powershell
npm run build
npm run publish:firefox
```

## Manual Dashboard Fallback

Chrome:

1. Open the Chrome Web Store Developer Dashboard.
2. Upload `dist/VolumeNormalizer-Chrome.zip` to the existing item.
3. Submit for review.

Firefox:

1. Open the Add-ons Developer Hub.
2. Upload `dist/VolumeNormalizer-Firefox.zip` to the existing add-on.
3. Submit for review.

## Important Notes

- The manifest version must be higher than the latest store version.
- The Firefox `browser_specific_settings.gecko.id` must match the existing AMO listing.
- Chrome may require the listing and privacy tabs to be completed manually before API publishing works.
- If Chrome visibility settings are changed manually, publish once from the dashboard before using API publishing again.
