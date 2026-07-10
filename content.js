/**
 * Applies the configured volume target to media on supported sites.
 */

const SITES = globalThis.VOLUME_NORMALIZER_SITES;
const PROCESSED_ATTR = "data-volume-normalized";
const VOLUME_EPSILON = 0.01;
const MEDIA_RECHECK_MS = 10000;
const DISCOVERY_RESCAN_MS = 60000;
const SCAN_BUDGET_MS = 4;
const SCAN_TIMEOUT_MS = 250;
const MAX_QUEUED_SCANS = 128;
const SHOW_ELEMENT = 1;
const DEBUG = false;

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

let currentSettings = cloneDefaultSettings();
const currentSiteId = getCurrentSiteId();
const attachedMedia = new WeakSet();
const trackedMedia = new Set();
const observedRoots = new Set();
let observedRootSet = new WeakSet();
let scanJobs = [];
let scanJobCursor = 0;
let queuedScanRoots = new WeakSet();
let scanTimerId = null;
let mediaObserver = null;

function debugLog(...args) {
  if (DEBUG) {
    console.debug("[Volume Normalizer]", ...args);
  }
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

function hostnameMatchesDomain(hostname, domain) {
  const normalizedHostname = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return (
    normalizedHostname === normalizedDomain ||
    normalizedHostname.endsWith(`.${normalizedDomain}`)
  );
}

function addHostnameFromUrl(hostnames, rawUrl) {
  if (!rawUrl) {
    return;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.hostname) {
      hostnames.add(parsedUrl.hostname);
      return;
    }

    if (parsedUrl.origin && parsedUrl.origin !== "null") {
      const originUrl = new URL(parsedUrl.origin);
      if (originUrl.hostname) {
        hostnames.add(originUrl.hostname);
      }
    }
  } catch (error) {
    debugLog("Could not inspect related frame URL:", error);
  }
}

function getSiteIdForUrl(rawUrl) {
  const hostnames = new Set();
  addHostnameFromUrl(hostnames, rawUrl);

  for (const site of SITES) {
    if (
      site.domains.some((domain) =>
        Array.from(hostnames).some((hostname) => hostnameMatchesDomain(hostname, domain))
      )
    ) {
      return site.id;
    }
  }

  return null;
}

function getCurrentSiteId() {
  const directSiteId = getSiteIdForUrl(window.location.href);
  if (directSiteId) {
    return directSiteId;
  }

  const referrerSiteId = getSiteIdForUrl(document.referrer);
  if (referrerSiteId) {
    return referrerSiteId;
  }

  const ancestorOrigins = window.location.ancestorOrigins;
  if (ancestorOrigins) {
    for (let index = 0; index < ancestorOrigins.length; index += 1) {
      const ancestorSiteId = getSiteIdForUrl(ancestorOrigins[index]);
      if (ancestorSiteId) {
        return ancestorSiteId;
      }
    }
  }

  return null;
}

function isSiteEnabled() {
  return Boolean(
    currentSiteId && currentSettings.enabledSites[currentSiteId] !== false
  );
}

function getTargetVolume() {
  return currentSettings.volume / 100;
}

function getNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function setVolumeSafely(element, targetVolume) {
  if (Math.abs(element.volume - targetVolume) <= VOLUME_EPSILON) {
    return true;
  }

  try {
    element.volume = targetVolume;
    return Math.abs(element.volume - targetVolume) <= VOLUME_EPSILON;
  } catch (error) {
    debugLog("Failed to set media volume:", error);
    return false;
  }
}

function markElementProcessed(element, volumeAttribute) {
  if (element.getAttribute(PROCESSED_ATTR) !== volumeAttribute) {
    element.setAttribute(PROCESSED_ATTR, volumeAttribute);
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

    const volumeAttribute = String(currentSettings.volume);
    if (setVolumeSafely(element, getTargetVolume())) {
      markElementProcessed(element, volumeAttribute);
    }
  };

  element.addEventListener("volumechange", reapplyVolume, { passive: true });
  element.addEventListener("play", reapplyVolume, { passive: true });
  element.addEventListener("loadedmetadata", reapplyVolume, { passive: true });
  attachedMedia.add(element);
}

function normalizeMediaElement(
  element,
  targetVolume = getTargetVolume(),
  volumeAttribute = String(currentSettings.volume)
) {
  if (!(element instanceof HTMLMediaElement) || !isSiteEnabled()) {
    return;
  }

  trackedMedia.add(element);
  attachMediaListeners(element);

  if (setVolumeSafely(element, targetVolume)) {
    markElementProcessed(element, volumeAttribute);
  }
}

function isScannableRoot(root) {
  return (
    root instanceof Document ||
    root instanceof DocumentFragment ||
    root instanceof Element
  );
}

function isRootConnected(root) {
  if (root instanceof ShadowRoot) {
    return root.host.isConnected;
  }
  if (root instanceof Element) {
    return root.isConnected;
  }
  return true;
}

function observeRoot(root) {
  if (!mediaObserver || !isScannableRoot(root) || observedRootSet.has(root)) {
    return;
  }

  mediaObserver.observe(root, { childList: true, subtree: true });
  observedRootSet.add(root);
  observedRoots.add(root);
}

function inspectElement(element, targetVolume, volumeAttribute) {
  if (element instanceof HTMLMediaElement) {
    normalizeMediaElement(element, targetVolume, volumeAttribute);
  }

  if (element.shadowRoot) {
    observeRoot(element.shadowRoot);
    queueRootScan(element.shadowRoot);
  }
}

function createScanJob(root) {
  return {
    root,
    inspectedRoot: !(root instanceof Element),
    walker: document.createTreeWalker(root, SHOW_ELEMENT)
  };
}

function advanceScanJob(job, targetVolume, volumeAttribute) {
  if (!job.inspectedRoot) {
    job.inspectedRoot = true;
    inspectElement(job.root, targetVolume, volumeAttribute);
    return true;
  }

  const element = job.walker.nextNode();
  if (!element) {
    return false;
  }

  inspectElement(element, targetVolume, volumeAttribute);
  return true;
}

function shouldPauseScan(startTime, deadline, processedCount) {
  if (processedCount === 0) {
    return false;
  }
  if (getNow() - startTime >= SCAN_BUDGET_MS) {
    return true;
  }
  return Boolean(
    deadline &&
      typeof deadline.timeRemaining === "function" &&
      !deadline.didTimeout &&
      deadline.timeRemaining() < 1
  );
}

function resetScanQueue() {
  scanJobs = [];
  scanJobCursor = 0;
  queuedScanRoots = new WeakSet();
}

function flushScanQueue(deadline = null) {
  scanTimerId = null;

  if (!isSiteEnabled()) {
    resetScanQueue();
    return;
  }

  const targetVolume = getTargetVolume();
  const volumeAttribute = String(currentSettings.volume);
  const startTime = getNow();
  let processedCount = 0;

  while (scanJobCursor < scanJobs.length) {
    const job = scanJobs[scanJobCursor];

    if (!isRootConnected(job.root)) {
      queuedScanRoots.delete(job.root);
      scanJobCursor += 1;
      continue;
    }

    const hasMore = advanceScanJob(job, targetVolume, volumeAttribute);
    processedCount += 1;

    if (!hasMore) {
      queuedScanRoots.delete(job.root);
      scanJobCursor += 1;
    }

    if (shouldPauseScan(startTime, deadline, processedCount)) {
      break;
    }
  }

  if (scanJobCursor >= scanJobs.length) {
    resetScanQueue();
    return;
  }

  scheduleScanFlush();
}

function scheduleScanFlush() {
  if (scanTimerId !== null) {
    return;
  }

  if (typeof window.requestIdleCallback === "function") {
    scanTimerId = window.requestIdleCallback(flushScanQueue, {
      timeout: SCAN_TIMEOUT_MS
    });
    return;
  }

  scanTimerId = window.setTimeout(flushScanQueue, 16);
}

function coalesceScansToDocument() {
  resetScanQueue();
  queuedScanRoots.add(document);
  scanJobs.push(createScanJob(document));
}

function queueRootScan(root) {
  if (!isScannableRoot(root) || !isRootConnected(root) || !isSiteEnabled()) {
    return;
  }

  if (root instanceof HTMLMediaElement) {
    normalizeMediaElement(root);
    return;
  }

  if (root instanceof Element && root.childElementCount === 0 && !root.shadowRoot) {
    return;
  }

  if (queuedScanRoots.has(root)) {
    return;
  }

  if (scanJobs.length - scanJobCursor >= MAX_QUEUED_SCANS) {
    coalesceScansToDocument();
  } else {
    queuedScanRoots.add(root);
    scanJobs.push(createScanJob(root));
  }

  scheduleScanFlush();
}

function pruneObservedRoots() {
  const connectedRoots = [];
  let removedRoot = false;

  for (const root of observedRoots) {
    if (isRootConnected(root)) {
      connectedRoots.push(root);
    } else {
      removedRoot = true;
    }
  }

  if (!removedRoot) {
    return;
  }

  mediaObserver.disconnect();
  observedRoots.clear();
  observedRootSet = new WeakSet();
  for (const root of connectedRoots) {
    observeRoot(root);
  }
}

function normalizeTrackedMedia() {
  const enabled = isSiteEnabled();
  const targetVolume = getTargetVolume();
  const volumeAttribute = String(currentSettings.volume);

  for (const element of trackedMedia) {
    if (!element.isConnected) {
      trackedMedia.delete(element);
      continue;
    }
    if (enabled) {
      normalizeMediaElement(element, targetVolume, volumeAttribute);
    }
  }
}

function clearProcessedMarkers() {
  for (const element of trackedMedia) {
    if (!element.isConnected) {
      trackedMedia.delete(element);
      continue;
    }
    element.removeAttribute(PROCESSED_ATTR);
  }
}

function setupObserver() {
  mediaObserver = new MutationObserver((mutations) => {
    if (!isSiteEnabled()) {
      return;
    }

    for (const mutation of mutations) {
      for (const addedNode of mutation.addedNodes) {
        if (addedNode.nodeType === Node.ELEMENT_NODE) {
          queueRootScan(addedNode);
        }
      }
    }
  });

  observeRoot(document);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (settings) => {
      if (chrome.runtime.lastError) {
        debugLog("Failed to load settings:", chrome.runtime.lastError.message);
        currentSettings = cloneDefaultSettings();
      } else {
        currentSettings = sanitizeSettings(settings);
      }
      resolve();
    });
  });
}

function setupSettingsListener() {
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "sync") {
      return;
    }

    const wasEnabled = isSiteEnabled();
    const nextSettings = {
      volume: currentSettings.volume,
      enabledSites: currentSettings.enabledSites
    };

    if (changes.volume) {
      nextSettings.volume = clampVolume(changes.volume.newValue);
    }
    if (changes.enabledSites) {
      nextSettings.enabledSites = sanitizeEnabledSites(changes.enabledSites.newValue);
    }

    currentSettings = nextSettings;
    const isEnabled = isSiteEnabled();

    if (!isEnabled) {
      resetScanQueue();
      if (wasEnabled) {
        clearProcessedMarkers();
      }
      return;
    }

    normalizeTrackedMedia();
    queueRootScan(document);
  });
}

function setupFallbackChecks() {
  window.setInterval(() => {
    if (document.visibilityState === "visible") {
      normalizeTrackedMedia();
    }
  }, MEDIA_RECHECK_MS);

  window.setInterval(() => {
    if (document.visibilityState === "visible" && isSiteEnabled()) {
      pruneObservedRoots();
      queueRootScan(document);
    }
  }, DISCOVERY_RESCAN_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isSiteEnabled()) {
      normalizeTrackedMedia();
      queueRootScan(document);
    }
  });
}

function setupCapturedPlaybackCheck() {
  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLMediaElement) {
        normalizeMediaElement(event.target);
      }
    },
    true
  );
}

async function init() {
  if (!currentSiteId) {
    debugLog("No supported site found for this frame");
    return;
  }

  await loadSettings();
  setupSettingsListener();
  setupObserver();
  setupCapturedPlaybackCheck();
  setupFallbackChecks();

  if (isSiteEnabled()) {
    queueRootScan(document);
  }

  debugLog(`Initialized for ${currentSiteId}`);
}

void init();
