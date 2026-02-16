/**
 * Volume Normalizer - Popup Script
 * Handles settings UI for volume level and site toggles.
 */

const SITES = [
  { id: "x", name: "X / Twitter", icon: "X" },
  { id: "tiktok", name: "TikTok", icon: "TT" },
  { id: "instagram", name: "Instagram", icon: "IG" },
  { id: "facebook", name: "Facebook", icon: "FB" },
  { id: "youtube", name: "YouTube", icon: "YT" },
  { id: "twitch", name: "Twitch", icon: "TW" },
  { id: "reddit", name: "Reddit", icon: "RD" },
  { id: "dailymotion", name: "Dailymotion", icon: "DM" },
  { id: "vimeo", name: "Vimeo", icon: "VM" },
  { id: "snapchat", name: "Snapchat", icon: "SC" },
  { id: "pinterest", name: "Pinterest", icon: "PN" },
  { id: "tumblr", name: "Tumblr", icon: "TB" },
  { id: "linkedin", name: "LinkedIn", icon: "LI" }
];

const DEFAULT_SETTINGS = {
  volume: 25,
  enabledSites: SITES.reduce((acc, site) => {
    acc[site.id] = true;
    return acc;
  }, {})
};

const SAVE_DEBOUNCE_MS = 150;

const volumeSlider = document.getElementById("volumeSlider");
const volumeInput = document.getElementById("volumeInput");
const sitesList = document.getElementById("sitesList");

let currentSettings = { ...DEFAULT_SETTINGS };
let pendingSave = {};
let pendingSaveTimerId = null;
let saveSequence = Promise.resolve();

function clampVolume(rawValue) {
  const numberValue = Number(rawValue);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_SETTINGS.volume;
  }
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function sanitizeEnabledSites(rawEnabledSites) {
  const source = rawEnabledSites && typeof rawEnabledSites === "object" ? rawEnabledSites : {};
  const enabledSites = {};

  SITES.forEach((site) => {
    enabledSites[site.id] = source[site.id] !== false;
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

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn("[Volume Normalizer] Failed to load settings:", chrome.runtime.lastError.message);
        resolve({ ...DEFAULT_SETTINGS });
        return;
      }

      resolve(sanitizeSettings(settings));
    });
  });
}

function saveSettingsNow(settingsPatch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settingsPatch, () => {
      if (chrome.runtime.lastError) {
        console.warn("[Volume Normalizer] Failed to save settings:", chrome.runtime.lastError.message);
      }
      resolve();
    });
  });
}

async function flushPendingSave() {
  if (pendingSaveTimerId !== null) {
    window.clearTimeout(pendingSaveTimerId);
    pendingSaveTimerId = null;
  }

  if (Object.keys(pendingSave).length === 0) {
    return;
  }

  const settingsPatch = pendingSave;
  pendingSave = {};
  saveSequence = saveSequence.then(() => saveSettingsNow(settingsPatch));
  await saveSequence;
}

function queueSave(settingsPatch, immediate = false) {
  pendingSave = { ...pendingSave, ...settingsPatch };

  if (immediate) {
    return flushPendingSave();
  }

  if (pendingSaveTimerId !== null) {
    window.clearTimeout(pendingSaveTimerId);
  }
  pendingSaveTimerId = window.setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS);
}

function setVolumeUi(value) {
  volumeSlider.value = String(value);
  volumeInput.value = String(value);
}

function updateVolume(value, immediateSave = false) {
  const normalizedVolume = clampVolume(value);
  setVolumeUi(normalizedVolume);

  if (currentSettings.volume === normalizedVolume) {
    return;
  }

  currentSettings = {
    ...currentSettings,
    volume: normalizedVolume
  };
  queueSave({ volume: normalizedVolume }, immediateSave);
}

function createSiteToggle(site, enabled) {
  const div = document.createElement("div");
  div.className = "site-toggle";

  const siteInfo = document.createElement("div");
  siteInfo.className = "site-info";

  const iconSpan = document.createElement("span");
  iconSpan.className = "site-icon";
  iconSpan.textContent = site.icon;

  const nameSpan = document.createElement("span");
  nameSpan.className = "site-name";
  nameSpan.textContent = site.name;

  siteInfo.appendChild(iconSpan);
  siteInfo.appendChild(nameSpan);

  const label = document.createElement("label");
  label.className = "toggle";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.siteId = site.id;
  checkbox.checked = enabled;
  checkbox.setAttribute("aria-label", `${site.name} enabled`);

  const slider = document.createElement("span");
  slider.className = "toggle-slider";

  label.appendChild(checkbox);
  label.appendChild(slider);

  div.appendChild(siteInfo);
  div.appendChild(label);

  return div;
}

function renderSites(enabledSites) {
  while (sitesList.firstChild) {
    sitesList.removeChild(sitesList.firstChild);
  }

  const fragment = document.createDocumentFragment();
  SITES.forEach((site) => {
    const toggle = createSiteToggle(site, enabledSites[site.id] !== false);
    fragment.appendChild(toggle);
  });
  sitesList.appendChild(fragment);
}

function onSiteToggleChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox" || !target.dataset.siteId) {
    return;
  }

  currentSettings = {
    ...currentSettings,
    enabledSites: {
      ...currentSettings.enabledSites,
      [target.dataset.siteId]: target.checked
    }
  };
  queueSave({ enabledSites: currentSettings.enabledSites }, true);
}

async function init() {
  currentSettings = await loadSettings();

  setVolumeUi(currentSettings.volume);
  renderSites(currentSettings.enabledSites);

  volumeSlider.addEventListener("input", (event) => {
    updateVolume(event.target.value);
  });
  volumeSlider.addEventListener("change", (event) => {
    updateVolume(event.target.value, true);
  });

  volumeInput.addEventListener("input", (event) => {
    if (event.target.value.trim() === "") {
      return;
    }
    updateVolume(event.target.value);
  });

  volumeInput.addEventListener("blur", (event) => {
    const fallback = currentSettings.volume;
    const nextValue = event.target.value.trim() === "" ? fallback : event.target.value;
    updateVolume(nextValue, true);
  });

  volumeInput.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -1 : 1;
    updateVolume(currentSettings.volume + delta);
  });

  volumeSlider.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -1 : 1;
    updateVolume(currentSettings.volume + delta);
  });

  volumeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      updateVolume(volumeInput.value, true);
      volumeInput.blur();
    }
  });

  sitesList.addEventListener("change", onSiteToggleChange);

  window.addEventListener("beforeunload", () => {
    flushPendingSave();
  });
}

init();
