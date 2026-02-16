/**
 * Volume Normalizer - Content Script
 * Automatically normalizes video/audio volume on configured sites.
 */

const PROCESSED_ATTR = "data-volume-normalized";
const MEDIA_SELECTOR = "video, audio";
const VOLUME_EPSILON = 0.01;
const FALLBACK_RESCAN_MS = 5000;
const DEBUG = false;

// Site configuration - maps site IDs to domain patterns
const SITE_DOMAINS = {
  x: ["twitter.com", "x.com"],
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  facebook: ["facebook.com"],
  youtube: ["youtube.com"],
  twitch: ["twitch.tv"],
  reddit: ["reddit.com"],
  dailymotion: ["dailymotion.com"],
  vimeo: ["vimeo.com"],
  snapchat: ["snapchat.com"],
  pinterest: ["pinterest.com"],
  tumblr: ["tumblr.com"],
  linkedin: ["linkedin.com"]
};

// Default settings
const DEFAULT_SETTINGS = {
  volume: 25,
  enabledSites: Object.keys(SITE_DOMAINS).reduce((acc, siteId) => {
    acc[siteId] = true;
    return acc;
  }, {})
};

// Current settings (loaded from storage)
let currentSettings = { ...DEFAULT_SETTINGS };
const currentSiteId = getCurrentSiteId(window.location.hostname);

const attachedMedia = new WeakSet();
const internalVolumeSet = new WeakMap();
let pendingNodes = new Set();
let flushTimerId = null;

function debugLog(...args) {
  if (DEBUG) {
    console.debug("[Volume Normalizer]", ...args);
  }
}

function clampVolume(rawValue) {
  const numberValue = Number(rawValue);
  if (!Number.isFinite(numberValue)) {
    return DEFAULT_SETTINGS.volume;
  }
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function sanitizeEnabledSites(rawEnabledSites) {
  const enabledSites = {};
  const source =
    rawEnabledSites && typeof rawEnabledSites === "object" ? rawEnabledSites : {};

  for (const siteId of Object.keys(SITE_DOMAINS)) {
    enabledSites[siteId] = source[siteId] !== false;
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

/**
 * Match only exact domains or subdomains.
 */
function hostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

/**
 * Get the current site ID based on hostname.
 */
function getCurrentSiteId(hostname) {
  for (const [siteId, domains] of Object.entries(SITE_DOMAINS)) {
    if (domains.some((domain) => hostnameMatchesDomain(hostname, domain))) {
      return siteId;
    }
  }
  return null;
}

/**
 * Check if the current site is enabled.
 */
function isSiteEnabled() {
  if (!currentSiteId) {
    return false;
  }
  return currentSettings.enabledSites[currentSiteId] !== false;
}

/**
 * Get target volume (0-1 scale).
 */
function getTargetVolume() {
  return currentSettings.volume / 100;
}

function shouldUpdateVolume(element, targetVolume) {
  return Math.abs(element.volume - targetVolume) > VOLUME_EPSILON;
}

function setVolumeSafely(element, targetVolume) {
  if (!shouldUpdateVolume(element, targetVolume) || internalVolumeSet.get(element)) {
    return;
  }

  internalVolumeSet.set(element, true);
  try {
    element.volume = targetVolume;
  } catch (error) {
    debugLog("Failed to set volume on element:", error);
  } finally {
    internalVolumeSet.set(element, false);
  }
}

function attachMediaListeners(element) {
  if (attachedMedia.has(element)) {
    return;
  }

  const reapplyVolume = () => {
    if (!isSiteEnabled()) {
      return;
    }

    setVolumeSafely(element, getTargetVolume());
    element.setAttribute(PROCESSED_ATTR, String(currentSettings.volume));
  };

  element.addEventListener("volumechange", () => {
    if (internalVolumeSet.get(element)) {
      return;
    }
    reapplyVolume();
  });
  element.addEventListener("play", reapplyVolume);
  element.addEventListener("loadeddata", reapplyVolume);

  attachedMedia.add(element);
}

/**
 * Normalize volume on one media element.
 */
function normalizeMediaElement(element) {
  if (!(element instanceof HTMLMediaElement) || !isSiteEnabled()) {
    return;
  }

  attachMediaListeners(element);
  setVolumeSafely(element, getTargetVolume());
  element.setAttribute(PROCESSED_ATTR, String(currentSettings.volume));
}

function normalizeMediaNode(node) {
  if (!(node instanceof Element)) {
    return;
  }

  if (node.matches(MEDIA_SELECTOR)) {
    normalizeMediaElement(node);
  }

  node.querySelectorAll(MEDIA_SELECTOR).forEach((mediaElement) => {
    normalizeMediaElement(mediaElement);
  });
}

/**
 * Find and normalize all media elements on the page.
 */
function normalizeAllMedia() {
  if (!isSiteEnabled()) {
    return;
  }

  document.querySelectorAll(MEDIA_SELECTOR).forEach((mediaElement) => {
    const lastVolume = mediaElement.getAttribute(PROCESSED_ATTR);
    if (
      lastVolume !== String(currentSettings.volume) ||
      shouldUpdateVolume(mediaElement, getTargetVolume())
    ) {
      normalizeMediaElement(mediaElement);
    } else {
      attachMediaListeners(mediaElement);
    }
  });
}

function flushPendingNodes() {
  flushTimerId = null;

  if (!isSiteEnabled()) {
    pendingNodes.clear();
    return;
  }

  for (const node of pendingNodes) {
    normalizeMediaNode(node);
  }
  pendingNodes.clear();
}

function scheduleNodeNormalization(node) {
  pendingNodes.add(node);
  if (flushTimerId !== null) {
    return;
  }

  flushTimerId = window.setTimeout(flushPendingNodes, 60);
}

/**
 * Set up MutationObserver to catch dynamically added media.
 */
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((addedNode) => {
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            scheduleNodeNormalization(addedNode);
          }
        });
      }

      if (
        mutation.type === "attributes" &&
        mutation.target instanceof HTMLMediaElement
      ) {
        mutation.target.removeAttribute(PROCESSED_ATTR);
        scheduleNodeNormalization(mutation.target);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"]
  });
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      currentSettings = sanitizeSettings(settings);
      resolve();
    });
  });
}

/**
 * Listen for settings changes.
 */
function setupSettingsListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "sync") {
      return;
    }

    const nextSettings = { ...currentSettings };

    if (changes.volume) {
      nextSettings.volume = clampVolume(changes.volume.newValue);
    }

    if (changes.enabledSites) {
      nextSettings.enabledSites = sanitizeEnabledSites(changes.enabledSites.newValue);
    }

    currentSettings = nextSettings;
    normalizeAllMedia();
  });
}

/**
 * Initialize content script.
 */
async function init() {
  if (!currentSiteId) {
    debugLog("Site not supported for hostname:", window.location.hostname);
    return;
  }

  await loadSettings();
  setupSettingsListener();
  setupObserver();
  normalizeAllMedia();

  // Low-frequency fallback for websites that bypass events/observers.
  window.setInterval(() => {
    if (document.visibilityState === "visible" && isSiteEnabled()) {
      normalizeAllMedia();
    }
  }, FALLBACK_RESCAN_MS);

  debugLog(`Initialized for ${currentSiteId}`);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
