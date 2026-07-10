/**
 * Popup controls and settings persistence.
 */

const SITES = globalThis.VOLUME_NORMALIZER_SITES;
const SAVE_DELAY_MS = 140;

if (!Array.isArray(SITES) || SITES.length === 0) {
  throw new Error("Volume Normalizer site configuration is unavailable");
}

const DEFAULT_SETTINGS = {
  volume: 25,
  enabledSites: SITES.reduce((enabledSites, site) => {
    enabledSites[site.id] = true;
    return enabledSites;
  }, {})
};

const enabledSitesValue = document.getElementById("enabledSitesValue");
const volumeSlider = document.getElementById("volumeSlider");
const volumeInput = document.getElementById("volumeInput");
const volumeTone = document.getElementById("volumeTone");
const presetButtons = document.getElementById("presetButtons");
const sitesList = document.getElementById("sitesList");
const enableAllButton = document.getElementById("enableAllButton");
const disableAllButton = document.getElementById("disableAllButton");
const saveStatus = document.getElementById("saveStatus");
const versionValue = document.getElementById("versionValue");

let currentSettings = cloneDefaultSettings();
let pendingSavePatch = {};
let saveTimerId = null;
let saveSequence = Promise.resolve();
let saveRevision = 0;

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
  const source =
    rawEnabledSites && typeof rawEnabledSites === "object" ? rawEnabledSites : {};
  const enabledSites = {};

  for (const site of SITES) {
    enabledSites[site.id] = source[site.id] !== false;
  }

  return enabledSites;
}

function sanitizeSettings(rawSettings) {
  const settings = rawSettings && typeof rawSettings === "object" ? rawSettings : {};
  return {
    volume: clampVolume(settings.volume),
    enabledSites: sanitizeEnabledSites(settings.enabledSites)
  };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response ?? null);
    });
  });
}

function getStoredSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        resolve(cloneDefaultSettings());
        return;
      }
      resolve(sanitizeSettings(settings));
    });
  });
}

async function loadSettings() {
  const response = await sendRuntimeMessage({ type: "get-settings" });
  if (response?.ok && response.settings) {
    return sanitizeSettings(response.settings);
  }
  return getStoredSettings();
}

function saveSettingsDirectly(settingsPatch) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(settingsPatch, () => {
      resolve(!chrome.runtime.lastError);
    });
  });
}

async function saveSettingsNow(settingsPatch) {
  const response = await sendRuntimeMessage({
    type: "save-settings",
    settingsPatch,
    debounce: false
  });

  if (response?.ok) {
    return true;
  }
  return saveSettingsDirectly(settingsPatch);
}

function setSaveStatus(state) {
  saveStatus.dataset.state = state;
  if (state === "saving") {
    saveStatus.textContent = "Saving";
  } else if (state === "error") {
    saveStatus.textContent = "Save failed";
  } else {
    saveStatus.textContent = "Saved";
  }
}

function flushQueuedSave() {
  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
    saveTimerId = null;
  }

  if (Object.keys(pendingSavePatch).length === 0) {
    return saveSequence;
  }

  const settingsPatch = pendingSavePatch;
  const revision = saveRevision;
  pendingSavePatch = {};

  const savePromise = saveSequence
    .catch(() => {})
    .then(() => saveSettingsNow(settingsPatch));
  saveSequence = savePromise;

  savePromise.then((saved) => {
    if (revision === saveRevision && Object.keys(pendingSavePatch).length === 0) {
      setSaveStatus(saved ? "saved" : "error");
    }
  });

  return savePromise;
}

function queueSave(settingsPatch, immediate = false) {
  pendingSavePatch = { ...pendingSavePatch, ...settingsPatch };
  saveRevision += 1;
  setSaveStatus("saving");

  if (immediate) {
    return flushQueuedSave();
  }

  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
  }
  saveTimerId = window.setTimeout(flushQueuedSave, SAVE_DELAY_MS);
  return saveSequence;
}

function flushPendingSaveOnClose() {
  if (Object.keys(pendingSavePatch).length === 0) {
    return;
  }

  const settingsPatch = pendingSavePatch;
  pendingSavePatch = {};
  if (saveTimerId !== null) {
    clearTimeout(saveTimerId);
    saveTimerId = null;
  }

  chrome.runtime.sendMessage(
    { type: "save-settings", settingsPatch, debounce: false },
    () => void chrome.runtime.lastError
  );
}

function getEnabledSiteCount(enabledSites) {
  return SITES.reduce(
    (count, site) => count + (enabledSites[site.id] !== false ? 1 : 0),
    0
  );
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

function sanitizeVolumeInputText(rawValue) {
  return String(rawValue ?? "")
    .replace(/[^\d]/g, "")
    .slice(0, 3);
}

function updatePresetUi(volume) {
  const buttons = presetButtons.querySelectorAll("[data-volume]");
  buttons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.volume) === volume)
    );
  });
}

function setVolumeUi(value) {
  const displayValue = String(value);
  volumeSlider.value = displayValue;
  volumeSlider.style.setProperty("--volume-percent", `${value}%`);
  volumeInput.value = displayValue;
  volumeTone.textContent = getVolumeToneLabel(value);
  updatePresetUi(value);
}

function updateVolume(value, immediateSave = false) {
  const normalizedVolume = clampVolume(value);
  const changed = currentSettings.volume !== normalizedVolume;
  setVolumeUi(normalizedVolume);

  if (changed) {
    currentSettings = { ...currentSettings, volume: normalizedVolume };
  }

  if (changed || immediateSave) {
    queueSave({ volume: normalizedVolume }, immediateSave);
  }
}

function updateEnabledSitesUi(enabledSites) {
  enabledSitesValue.textContent = `${getEnabledSiteCount(enabledSites)}/${SITES.length}`;
}

function createSiteToggle(site, enabled) {
  const container = document.createElement("div");
  container.className = "site-toggle";
  container.dataset.enabled = String(enabled);

  const icon = document.createElement("span");
  icon.className = "site-icon";
  icon.textContent = site.icon;
  icon.setAttribute("aria-hidden", "true");

  const name = document.createElement("span");
  name.className = "site-name";
  name.textContent = site.name;
  name.title = site.name;

  const label = document.createElement("label");
  label.className = "switch";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.dataset.siteId = site.id;
  checkbox.checked = enabled;
  checkbox.setAttribute("aria-label", `${site.name} enabled`);

  const track = document.createElement("span");
  track.className = "switch-track";
  track.setAttribute("aria-hidden", "true");

  label.append(checkbox, track);
  container.append(icon, name, label);
  return container;
}

function renderSites(enabledSites) {
  const fragment = document.createDocumentFragment();
  for (const site of SITES) {
    fragment.appendChild(createSiteToggle(site, enabledSites[site.id] !== false));
  }
  sitesList.replaceChildren(fragment);
}

function setAllSites(enabled) {
  const enabledSites = {};
  for (const site of SITES) {
    enabledSites[site.id] = enabled;
  }

  currentSettings = { ...currentSettings, enabledSites };
  updateEnabledSitesUi(enabledSites);
  renderSites(enabledSites);
  queueSave({ enabledSites }, true);
}

function onSiteToggleChange(event) {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) ||
    target.type !== "checkbox" ||
    !target.dataset.siteId
  ) {
    return;
  }

  const siteToggle = target.closest(".site-toggle");
  if (siteToggle) {
    siteToggle.dataset.enabled = String(target.checked);
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

function onVolumeInput(event) {
  const sanitizedValue = sanitizeVolumeInputText(event.target.value);
  event.target.value = sanitizedValue;
  if (sanitizedValue !== "") {
    updateVolume(sanitizedValue);
  }
}

function commitVolumeInput() {
  const sanitizedValue = sanitizeVolumeInputText(volumeInput.value);
  updateVolume(sanitizedValue === "" ? currentSettings.volume : sanitizedValue, true);
}

function onVolumeWheel(event) {
  event.preventDefault();
  if (event.deltaY === 0) {
    return;
  }
  updateVolume(currentSettings.volume + (event.deltaY > 0 ? -1 : 1));
}

async function init() {
  currentSettings = await loadSettings();
  setVolumeUi(currentSettings.volume);
  updateEnabledSitesUi(currentSettings.enabledSites);
  renderSites(currentSettings.enabledSites);
  versionValue.textContent = `v${chrome.runtime.getManifest().version}`;
  setSaveStatus("saved");

  volumeSlider.addEventListener("input", (event) => updateVolume(event.target.value));
  volumeSlider.addEventListener("change", (event) => updateVolume(event.target.value, true));
  volumeSlider.addEventListener("wheel", onVolumeWheel, { passive: false });

  volumeInput.addEventListener("input", onVolumeInput);
  volumeInput.addEventListener("blur", commitVolumeInput);
  volumeInput.addEventListener("wheel", onVolumeWheel, { passive: false });
  volumeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      volumeInput.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      updateVolume(currentSettings.volume + (event.key === "ArrowUp" ? 1 : -1));
    }
  });

  presetButtons.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const button = event.target.closest("[data-volume]");
    if (button) {
      updateVolume(button.dataset.volume, true);
    }
  });

  sitesList.addEventListener("change", onSiteToggleChange);
  enableAllButton.addEventListener("click", () => setAllSites(true));
  disableAllButton.addEventListener("click", () => setAllSites(false));
  window.addEventListener("pagehide", flushPendingSaveOnClose);
}

void init();
