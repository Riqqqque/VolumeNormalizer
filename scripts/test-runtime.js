const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT_DIR = path.resolve(__dirname, "..");

class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) {
      listener({ type, target: this, ...event });
    }
  }
}

class FakeElement extends FakeEventTarget {
  constructor() {
    super();
    this.nodeType = 1;
    this.attributes = new Map();
    this.children = [];
    this.isConnected = true;
    this.shadowRoot = null;
  }

  get childElementCount() {
    return this.children.length;
  }

  append(...children) {
    this.children.push(...children);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

class FakeDocumentFragment extends FakeElement {}

class FakeShadowRoot extends FakeDocumentFragment {
  constructor(host) {
    super();
    this.host = host;
  }
}

class FakeMediaElement extends FakeElement {
  constructor() {
    super();
    this.volume = 1;
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super();
    this.referrer = "";
    this.visibilityState = "visible";
  }

  createTreeWalker(root) {
    const stack = [...(root.children || [])].reverse();
    return {
      nextNode() {
        const nextElement = stack.pop() || null;
        if (nextElement) {
          stack.push(...[...(nextElement.children || [])].reverse());
        }
        return nextElement;
      }
    };
  }
}

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    FakeMutationObserver.instance = this;
  }

  observe() {}

  disconnect() {}

  trigger({ addedNodes = [], removedNodes = [] }) {
    this.callback([{ addedNodes, removedNodes }]);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const document = new FakeDocument();
  const normalMedia = new FakeMediaElement();
  const shadowHost = new FakeElement();
  const shadowRoot = new FakeShadowRoot(shadowHost);
  const shadowMedia = new FakeMediaElement();
  shadowRoot.append(shadowMedia);
  shadowHost.shadowRoot = shadowRoot;
  document.append(normalMedia, shadowHost);

  const idleCallbacks = [];
  const timers = new Map();
  const windowEvents = new FakeEventTarget();
  let timerId = 0;
  let settingsListener = null;
  let performanceNow = 0;

  const window = {
    location: { href: "https://x.com/home" },
    ancestorOrigins: [],
    requestIdleCallback(callback) {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
    setTimeout(callback) {
      timerId += 1;
      timers.set(timerId, callback);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener: windowEvents.addEventListener.bind(windowEvents)
  };

  const sitesCode = fs.readFileSync(path.join(ROOT_DIR, "sites.js"), "utf8");
  const contentCode = fs.readFileSync(path.join(ROOT_DIR, "content.js"), "utf8");
  const context = vm.createContext({
    console,
    URL,
    Date,
    performance: {
      now() {
        performanceNow += 0.1;
        return performanceNow;
      }
    },
    globalThis: null,
    window,
    document,
    Node: { ELEMENT_NODE: 1 },
    Document: FakeDocument,
    DocumentFragment: FakeDocumentFragment,
    ShadowRoot: FakeShadowRoot,
    Element: FakeElement,
    HTMLMediaElement: FakeMediaElement,
    MutationObserver: FakeMutationObserver,
    chrome: {
      runtime: { lastError: null },
      storage: {
        sync: {
          get(_defaults, callback) {
            callback({ volume: 25, enabledSites: {} });
          }
        },
        onChanged: {
          addListener(listener) {
            settingsListener = listener;
          }
        }
      }
    }
  });
  context.globalThis = context;

  vm.runInContext(sitesCode, context, { filename: "sites.js" });
  vm.runInContext(contentCode, context, { filename: "content.js" });
  await new Promise((resolve) => setImmediate(resolve));

  for (let pass = 0; pass < 10 && idleCallbacks.length > 0; pass += 1) {
    const callback = idleCallbacks.shift();
    callback({ didTimeout: false, timeRemaining: () => 50 });
  }

  assert(normalMedia.volume === 0.25, "Normal media was not normalized");
  assert(
    normalMedia.getAttribute("data-volume-normalized") === "25",
    "Normal media marker is missing"
  );
  assert(shadowMedia.volume === 0.25, "Open shadow-root media was not normalized");
  assert(
    shadowMedia.getAttribute("data-volume-normalized") === "25",
    "Shadow-root media marker is missing"
  );

  const dynamicMedia = new FakeMediaElement();
  document.append(dynamicMedia);
  FakeMutationObserver.instance.trigger({ addedNodes: [dynamicMedia] });
  assert(dynamicMedia.volume === 0.25, "Dynamically inserted media was not normalized");

  dynamicMedia.isConnected = false;
  dynamicMedia.volume = 0.8;
  FakeMutationObserver.instance.trigger({ removedNodes: [dynamicMedia] });

  settingsListener({ volume: { newValue: 50 } }, "sync");
  assert(normalMedia.volume === 0.5, "Stored volume changes were not applied");
  assert(shadowMedia.volume === 0.5, "Stored volume changes missed shadow-root media");
  assert(dynamicMedia.volume === 0.8, "Removed media remained strongly tracked");

  const stressRoot = new FakeElement();
  for (let index = 0; index < 3000; index += 1) {
    stressRoot.append(new FakeElement());
  }
  const stressMedia = new FakeMediaElement();
  stressRoot.append(stressMedia);
  document.append(stressRoot);

  const stressStart = process.hrtime.bigint();
  FakeMutationObserver.instance.trigger({ addedNodes: [stressRoot] });
  let stressSlices = 0;
  while (idleCallbacks.length > 0 && stressSlices < 200) {
    const callback = idleCallbacks.shift();
    callback({ didTimeout: false, timeRemaining: () => 50 });
    stressSlices += 1;
  }
  const stressDurationMs = Number(process.hrtime.bigint() - stressStart) / 1e6;

  assert(stressMedia.volume === 0.5, "Large dynamic subtrees missed media");
  assert(stressSlices > 1, "Large dynamic subtrees were not time-sliced");
  assert(stressSlices < 200, "Large dynamic subtree scan did not complete");
  assert(stressDurationMs < 1000, "Large dynamic subtree smoke test exceeded one second");

  assert(timers.size === 1, "Expected one visible-tab fallback timer");
  document.visibilityState = "hidden";
  document.dispatch("visibilitychange");
  assert(timers.size === 0, "Hidden tabs must not retain fallback timers");

  document.visibilityState = "visible";
  document.dispatch("visibilitychange");
  assert(timers.size === 1, "Visible tabs must resume one fallback timer");

  console.log(
    `Checked media normalization and a 3,001-node scan in ${stressDurationMs.toFixed(2)}ms across ${stressSlices} slices`
  );
  console.log(
    "Checked shadow roots, dynamic media, removed-media cleanup, stored settings, and timer suspension"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
