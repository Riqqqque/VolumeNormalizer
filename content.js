/**
 * Volume Normalizer - Content Script
 * Automatically normalizes video/audio volume on configured sites.
 */

const PROCESSED_ATTR = "data-volume-normalized";
const MEDIA_SELECTOR = "video, audio";
const VOLUME_EPSILON = 0.01;
const FALLBACK_RESCAN_MS = 10000;
const PENDING_FLUSH_BUDGET_MS = 4;
const PENDING_FLUSH_TIMEOUT_MS = 250;
const MAX_PENDING_NODES = 250;
const DEBUG = false;

// Site configuration - maps site IDs to domain patterns
const SITE_DOMAINS = {
  x: ["twitter.com", "x.com"],
  bluesky: ["bsky.app"],
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
const passiveListenerOptions = { passive: true };
let pendingNodes = [];
let pendingNodeSet = new WeakSet();
let pendingNodeCursor = 0;
let pendingFullPageScan = false;
let flushTimerId = null;
let idleScanTimerId = null;

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

function getNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function markElementProcessed(element, volumeAttribute) {
  if (element.getAttribute(PROCESSED_ATTR) !== volumeAttribute) {
    element.setAttribute(PROCESSED_ATTR, volumeAttribute);
  }
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
    markElementProcessed(element, String(currentSettings.volume));
  };

  element.addEventListener("volumechange", () => {
    if (internalVolumeSet.get(element)) {
      return;
    }
    reapplyVolume();
  }, passiveListenerOptions);
  element.addEventListener("play", reapplyVolume, passiveListenerOptions);
  element.addEventListener("loadeddata", reapplyVolume, passiveListenerOptions);

  attachedMedia.add(element);
}

/**
 * Normalize volume on one media element.
 */
function normalizeMediaElement(
  element,
  targetVolume = getTargetVolume(),
  volumeAttribute = String(currentSettings.volume)
) {
  if (!(element instanceof HTMLMediaElement) || !isSiteEnabled()) {
    return;
  }

  attachMediaListeners(element);
  setVolumeSafely(element, targetVolume);
  markElementProcessed(element, volumeAttribute);
}

function normalizeMediaNode(
  node,
  targetVolume = getTargetVolume(),
  volumeAttribute = String(currentSettings.volume)
) {
  if (!(node instanceof Element) || !node.isConnected) {
    return;
  }

  if (node instanceof HTMLMediaElement) {
    normalizeMediaElement(node, targetVolume, volumeAttribute);
    return;
  }

  if (node.childElementCount === 0) {
    return;
  }

  node.querySelectorAll(MEDIA_SELECTOR).forEach((mediaElement) => {
    normalizeMediaElement(mediaElement, targetVolume, volumeAttribute);
  });
}

/**
 * Find and normalize all media elements on the page.
 */
function normalizeAllMedia() {
  if (!isSiteEnabled()) {
    return;
  }

  const targetVolume = getTargetVolume();
  const volumeAttribute = String(currentSettings.volume);

  document.querySelectorAll(MEDIA_SELECTOR).forEach((mediaElement) => {
    const lastVolume = mediaElement.getAttribute(PROCESSED_ATTR);
    if (
      lastVolume !== volumeAttribute ||
      shouldUpdateVolume(mediaElement, targetVolume)
    ) {
      normalizeMediaElement(mediaElement, targetVolume, volumeAttribute);
    } else {
      attachMediaListeners(mediaElement);
    }
  });
}

function resetPendingQueue() {
  pendingNodes = [];
  pendingNodeSet = new WeakSet();
  pendingNodeCursor = 0;
  pendingFullPageScan = false;
}

function coalescePendingQueueToPageScan() {
  pendingNodes = [document.documentElement];
  pendingNodeSet = new WeakSet(pendingNodes);
  pendingNodeCursor = 0;
  pendingFullPageScan = true;
}

function shouldPauseFlush(startTime, deadline, processedCount) {
  if (processedCount === 0) {
    return false;
  }

  if (getNow() - startTime >= PENDING_FLUSH_BUDGET_MS) {
    return true;
  }

  if (deadline && typeof deadline.timeRemaining === "function") {
    return !deadline.didTimeout && deadline.timeRemaining() < 1;
  }

  return false;
}

function flushPendingNodes(deadline = null) {
  flushTimerId = null;

  if (!isSiteEnabled()) {
    resetPendingQueue();
    return;
  }

  const targetVolume = getTargetVolume();
  const volumeAttribute = String(currentSettings.volume);
  const startTime = getNow();
  let processedCount = 0;

  while (pendingNodeCursor < pendingNodes.length) {
    const node = pendingNodes[pendingNodeCursor];
    pendingNodeCursor += 1;
    processedCount += 1;

    normalizeMediaNode(node, targetVolume, volumeAttribute);

    if (shouldPauseFlush(startTime, deadline, processedCount)) {
      break;
    }
  }

  if (pendingNodeCursor >= pendingNodes.length) {
    resetPendingQueue();
    return;
  }

  schedulePendingFlush();
}

function schedulePendingFlush() {
  if (flushTimerId !== null) {
    return;
  }

  if ("requestIdleCallback" in window) {
    flushTimerId = window.requestIdleCallback(flushPendingNodes, {
      timeout: PENDING_FLUSH_TIMEOUT_MS
    });
    return;
  }

  flushTimerId = window.setTimeout(flushPendingNodes, PENDING_FLUSH_TIMEOUT_MS);
}

function scheduleNodeNormalization(node) {
  if (!(node instanceof Element) || !isSiteEnabled()) {
    return;
  }

  if (node instanceof HTMLMediaElement) {
    normalizeMediaElement(node);
    return;
  }

  if (node.childElementCount === 0 || pendingFullPageScan) {
    return;
  }

  if (pendingNodeSet.has(node)) {
    return;
  }

  if (pendingNodes.length - pendingNodeCursor >= MAX_PENDING_NODES) {
    coalescePendingQueueToPageScan();
    schedulePendingFlush();
    return;
  }

  pendingNodes.push(node);
  pendingNodeSet.add(node);
  schedulePendingFlush();
}

function scheduleIdleMediaScan() {
  if (idleScanTimerId !== null) {
    return;
  }

  const runScan = () => {
    idleScanTimerId = null;
    if (document.visibilityState === "visible" && isSiteEnabled()) {
      normalizeAllMedia();
    }
  };

  if ("requestIdleCallback" in window) {
    idleScanTimerId = window.requestIdleCallback(runScan, { timeout: 1000 });
    return;
  }

  idleScanTimerId = window.setTimeout(runScan, 250);
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
      if (chrome.runtime.lastError) {
        debugLog("Failed to load settings:", chrome.runtime.lastError.message);
        currentSettings = {
          volume: DEFAULT_SETTINGS.volume,
          enabledSites: { ...DEFAULT_SETTINGS.enabledSites }
        };
        resolve();
        return;
      }

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
    scheduleIdleMediaScan();
  }, FALLBACK_RESCAN_MS);

  debugLog(`Initialized for ${currentSiteId}`);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
