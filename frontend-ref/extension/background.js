// Atlas IDE — Background Service Worker

const ATLAS_URL_KEY = "atlas-ide-url";
const CAPTURES_KEY = "atlas-captures";
const DEFAULT_URL = "https://id-preview--5360bfd7-938b-4e8a-856c-6688429afae3.lovable.app";

// Context menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "atlas-capture-selection",
    title: "Send to Atlas IDE",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "atlas-capture-page",
    title: "Capture page for Atlas",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: "atlas-capture-image",
    title: "Send image to Atlas",
    contexts: ["image"],
  });
  chrome.contextMenus.create({
    id: "atlas-capture-link",
    title: "Send link to Atlas",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const capture = {
    type: info.menuItemId.replace("atlas-capture-", ""),
    url: tab?.url ?? "",
    title: tab?.title ?? "",
    timestamp: Date.now(),
    data: null,
  };

  if (info.menuItemId === "atlas-capture-selection") {
    capture.data = info.selectionText ?? null;
  } else if (info.menuItemId === "atlas-capture-image") {
    capture.data = info.srcUrl ?? null;
  } else if (info.menuItemId === "atlas-capture-link") {
    capture.data = info.linkUrl ?? null;
  }

  const result = await chrome.storage.local.get(CAPTURES_KEY);
  const captures = result[CAPTURES_KEY] || [];
  captures.unshift(capture);
  await chrome.storage.local.set({ [CAPTURES_KEY]: captures.slice(0, 50) });

  // Badge flash
  chrome.action.setBadgeText({ text: "✓" });
  chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
});

// Keyboard shortcut: quick-capture
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "quick-capture") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const capture = {
      type: "page",
      url: tab.url,
      title: tab.title,
      timestamp: Date.now(),
      favicon: tab.favIconUrl || null,
    };

    const result = await chrome.storage.local.get(CAPTURES_KEY);
    const captures = result[CAPTURES_KEY] || [];
    captures.unshift(capture);
    await chrome.storage.local.set({ [CAPTURES_KEY]: captures.slice(0, 50) });

    // Badge flash
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
  }
});

// Message handler for content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "page-metadata") {
    chrome.storage.local.get(CAPTURES_KEY, (result) => {
      const captures = result[CAPTURES_KEY] || [];
      captures.unshift({
        type: "metadata",
        url: sender.tab?.url ?? "",
        title: sender.tab?.title ?? "",
        timestamp: Date.now(),
        data: message.metadata,
      });
      chrome.storage.local.set({ [CAPTURES_KEY]: captures.slice(0, 50) });
      sendResponse({ success: true });
    });
    return true;
  }
});
