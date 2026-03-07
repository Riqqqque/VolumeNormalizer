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

const heroVolumeValue = document.getElementById("heroVolumeValue");
const enabledSitesValue = document.getElementById("enabledSitesValue");
const volumeSlider = document.getElementById("volumeSlider");
const volumeInput = document.getElementById("volumeInput");
const volumeTone = document.getElementById("volumeTone");
const volumeProgressFill = document.getElementById("volumeProgressFill");
const sitesSectionHint = document.getElementById("sitesSectionHint");
const sitesList = document.getElementById("sitesList");

let currentSettings = { ...DEFAULT_SETTINGS };
let pendingSave = {};
let pendingSaveTimerId = null;
let saveSequence = Promise.resolve();

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Volume Normalizer] Runtime messaging failed:",
          chrome.runtime.lastError.message
        );
        resolve(null);
        return;
      }

      resolve(response ?? null);
    });
  });
}

function cloneDefaultSettings() {
  return {
    volume: DEFAULT_SETTINGS.volume,
    enabledSites: { ...DEFAULT_SETTINGS.enabledSites }
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

async function loadSettings() {
  const response = await sendRuntimeMessage({ type: "get-settings" });
  if (response && response.ok && response.settings) {
    return sanitizeSettings(response.settings);
  }

  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Volume Normalizer] Failed to load settings:",
          chrome.runtime.lastError.message
        );
        resolve(cloneDefaultSettings());
        return;
      }

      resolve(sanitizeSettings(settings));
    });
  });
}

function saveSettingsDirectly(settingsPatch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settingsPatch, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          "[Volume Normalizer] Failed to save settings:",
          chrome.runtime.lastError.message
        );
      }
      resolve();
    });
  });
}

async function saveSettingsNow(settingsPatch) {
  const response = await sendRuntimeMessage({
    type: "save-settings",
    settingsPatch
  });

  if (response && response.ok) {
    return;
  }

  if (!response || !response.ok) {
    const errorMessage =
      response && response.error ? response.error : "background save unavailable";
    console.warn("[Volume Normalizer] Failed to save settings:", errorMessage);
    await saveSettingsDirectly(settingsPatch);
  }
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

function getEnabledSiteCount(enabledSites) {
  return SITES.reduce((count, site) => {
    return count + (enabledSites[site.id] !== false ? 1 : 0);
  }, 0);
}

function getVolumeToneLabel(volume) {
  if (volume === 0) {
    return "Muted";
  }
  if (volume <= 15) {
    return "Soft";
  }
  if (volume <= 35) {
    return "Balanced";
  }
  if (volume <= 60) {
    return "Lifted";
  }
  if (volume <= 85) {
    return "Strong";
  }
  return "Maxed";
}

function updateEnabledSitesUi(enabledSites) {
  const enabledCount = getEnabledSiteCount(enabledSites);
  enabledSitesValue.textContent = `${enabledCount}/${SITES.length}`;

  if (enabledCount === SITES.length) {
    sitesSectionHint.textContent = "All supported sites are active";
    return;
  }

  if (enabledCount === 0) {
    sitesSectionHint.textContent = "No sites are active";
    return;
  }

  sitesSectionHint.textContent = `${enabledCount} site${enabledCount === 1 ? "" : "s"} active`;
}

function sanitizeVolumeInputText(rawValue) {
  return String(rawValue ?? "")
    .replace(/[^\d]/g, "")
    .slice(0, 3);
}

function syncVolumeInputWidth(value) {
  const digitCount = Math.max(1, String(value).length);
  volumeInput.style.width = `${digitCount}ch`;
}

function setVolumeUi(value) {
  const displayValue = String(value);
  volumeSlider.value = String(value);
  volumeInput.value = displayValue;
  syncVolumeInputWidth(displayValue);
  heroVolumeValue.textContent = `${value}%`;
  volumeTone.textContent = getVolumeToneLabel(value);
  volumeProgressFill.style.width = `${value}%`;
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
  div.dataset.enabled = enabled ? "true" : "false";

  const siteInfo = document.createElement("div");
  siteInfo.className = "site-info";

  const iconSpan = document.createElement("span");
  iconSpan.className = "site-icon";
  iconSpan.textContent = site.icon;

  const siteCopy = document.createElement("div");
  siteCopy.className = "site-copy";

  const nameSpan = document.createElement("span");
  nameSpan.className = "site-name";
  nameSpan.textContent = site.name;

  const stateSpan = document.createElement("span");
  stateSpan.className = "site-state";
  stateSpan.textContent = enabled ? "On" : "Off";

  siteCopy.appendChild(nameSpan);
  siteCopy.appendChild(stateSpan);

  siteInfo.appendChild(iconSpan);
  siteInfo.appendChild(siteCopy);

  const siteAction = document.createElement("div");
  siteAction.className = "site-action";

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
  siteAction.appendChild(label);
  div.appendChild(siteAction);

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

  const siteToggle = target.closest(".site-toggle");
  if (siteToggle) {
    siteToggle.dataset.enabled = target.checked ? "true" : "false";
    const state = siteToggle.querySelector(".site-state");
    if (state) {
      state.textContent = target.checked ? "On" : "Off";
    }
  }

  currentSettings = {
    ...currentSettings,
    enabledSites: {
      ...currentSettings.enabledSites,
      [target.dataset.siteId]: target.checked
    }
  };
  updateEnabledSitesUi(currentSettings.enabledSites);
  queueSave({ enabledSites: currentSettings.enabledSites }, true);
}

async function init() {
  currentSettings = await loadSettings();

  setVolumeUi(currentSettings.volume);
  updateEnabledSitesUi(currentSettings.enabledSites);
  renderSites(currentSettings.enabledSites);

  volumeSlider.addEventListener("input", (event) => {
    updateVolume(event.target.value);
  });
  volumeSlider.addEventListener("change", (event) => {
    updateVolume(event.target.value, true);
  });

  volumeInput.addEventListener("input", (event) => {
    const sanitizedValue = sanitizeVolumeInputText(event.target.value);
    event.target.value = sanitizedValue;
    syncVolumeInputWidth(sanitizedValue);

    if (sanitizedValue === "") {
      return;
    }
    updateVolume(sanitizedValue);
  });

  volumeInput.addEventListener("blur", (event) => {
    const fallback = currentSettings.volume;
    const sanitizedValue = sanitizeVolumeInputText(event.target.value);
    const nextValue = sanitizedValue === "" ? fallback : sanitizedValue;
    updateVolume(nextValue, true);
  });

  volumeInput.addEventListener("change", (event) => {
    const sanitizedValue = sanitizeVolumeInputText(event.target.value);
    const nextValue = sanitizedValue === "" ? currentSettings.volume : sanitizedValue;
    updateVolume(nextValue, true);
  });

  volumeInput.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -1 : 1;
    updateVolume(currentSettings.volume + delta, true);
  });

  volumeSlider.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY > 0 ? -1 : 1;
    updateVolume(currentSettings.volume + delta, true);
  });

  volumeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      updateVolume(volumeInput.value, true);
      volumeInput.blur();
    }
  });

  sitesList.addEventListener("change", onSiteToggleChange);
}

init();
