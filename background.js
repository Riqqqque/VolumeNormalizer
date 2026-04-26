/**
 * Volume Normalizer - Background Script
 * Persists settings outside the popup lifecycle so writes survive popup teardown.
 */

const SITE_IDS = [
  "x",
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
  "twitch",
  "reddit",
  "dailymotion",
  "vimeo",
  "snapchat",
  "pinterest",
  "tumblr",
  "linkedin"
];

const DEFAULT_SETTINGS = {
  volume: 25,
  enabledSites: SITE_IDS.reduce((accumulator, siteId) => {
    accumulator[siteId] = true;
    return accumulator;
  }, {})
};

const SAVE_DEBOUNCE_MS = 150;

let pendingSave = {};
let pendingSaveTimerId = null;
let pendingSaveWaiters = [];
let saveSequence = Promise.resolve();

function cloneSettings(settings) {
  return {
    volume: settings.volume,
    enabledSites: { ...settings.enabledSites }
  };
}

function clampVolume(rawValue) {
  const numberValue = Number(rawValue);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_SETTINGS.volume;
  }
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function sanitizeEnabledSites(rawEnabledSites) {
  const source =
    rawEnabledSites && typeof rawEnabledSites === "object" ? rawEnabledSites : {};
  const enabledSites = {};

  SITE_IDS.forEach((siteId) => {
    enabledSites[siteId] = source[siteId] !== false;
  });

  return enabledSites;
}

function sanitizeSettings(rawSettings) {
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    volume: clampVolume(settings.volume),
    enabledSites: sanitizeEnabledSites(settings.enabledSites)
  };
}

function sanitizeSettingsPatch(rawPatch) {
  const patch = rawPatch && typeof rawPatch === "object" ? rawPatch : {};
  const nextPatch = {};

  if (Object.prototype.hasOwnProperty.call(patch, "volume")) {
    nextPatch.volume = clampVolume(patch.volume);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "enabledSites")) {
    nextPatch.enabledSites = sanitizeEnabledSites(patch.enabledSites);
  }

  return nextPatch;
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Volume Normalizer] Failed to load settings:",
          chrome.runtime.lastError.message
        );
        resolve(cloneSettings(DEFAULT_SETTINGS));
        return;
      }

      resolve(sanitizeSettings(settings));
    });
  });
}

function saveSettings(settingsPatch) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.set(settingsPatch, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

async function flushPendingSave() {
  if (pendingSaveTimerId !== null) {
    clearTimeout(pendingSaveTimerId);
    pendingSaveTimerId = null;
  }

  if (Object.keys(pendingSave).length === 0) {
    return;
  }

  const settingsPatch = pendingSave;
  const waiters = pendingSaveWaiters;
  pendingSave = {};
  pendingSaveWaiters = [];

  const savePromise = saveSequence.catch(() => {}).then(() => saveSettings(settingsPatch));
  saveSequence = savePromise.catch(() => {});

  try {
    await savePromise;
    waiters.forEach((waiter) => waiter.resolve());
  } catch (error) {
    console.warn(
      "[Volume Normalizer] Failed to save settings:",
      error instanceof Error ? error.message : String(error)
    );
    waiters.forEach((waiter) => waiter.reject(error));
  }
}

function queueSave(settingsPatch, debounce = true) {
  const sanitizedPatch = sanitizeSettingsPatch(settingsPatch);
  if (Object.keys(sanitizedPatch).length === 0) {
    return saveSequence;
  }

  pendingSave = { ...pendingSave, ...sanitizedPatch };

  const queuedSave = new Promise((resolve, reject) => {
    pendingSaveWaiters.push({ resolve, reject });
  });

  if (!debounce) {
    flushPendingSave();
    return queuedSave;
  }

  if (pendingSaveTimerId !== null) {
    clearTimeout(pendingSaveTimerId);
  }
  pendingSaveTimerId = setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS);

  return queuedSave;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  if (message.type === "get-settings") {
    loadSettings()
      .then((settings) => {
        sendResponse({
          ok: true,
          settings: cloneSettings(settings)
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  if (message.type === "save-settings") {
    queueSave(message.settingsPatch, message.debounce !== false)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  return undefined;
});
