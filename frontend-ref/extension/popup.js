// Atlas IDE Chrome Extension — Popup Logic v1.2

const ATLAS_URL_KEY = "atlas-ide-url";
const CAPTURES_KEY = "atlas-captures";
const RECENTS_KEY = "atlas-recent-projects";
const DEFAULT_URL = "https://id-preview--5360bfd7-938b-4e8a-856c-6688429afae3.lovable.app";

function getAtlasUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(ATLAS_URL_KEY, (result) => {
      resolve(result[ATLAS_URL_KEY] || DEFAULT_URL);
    });
  });
}

// ── Tab switching ──
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");

    if (tab.dataset.tab === "captures") loadCaptures();
    if (tab.dataset.tab === "projects") loadProjects();
  });
});

// ── Actions ──
document.getElementById("open-atlas").addEventListener("click", async () => {
  const url = await getAtlasUrl();
  chrome.tabs.create({ url });
  window.close();
});

document.getElementById("capture-page").addEventListener("click", async () => {
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

  showToast("Page context captured");
});

document.getElementById("extract-meta").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "extract-metadata" });
    if (response?.metadata) {
      const result = await chrome.storage.local.get(CAPTURES_KEY);
      const captures = result[CAPTURES_KEY] || [];
      captures.unshift({
        type: "metadata",
        url: tab.url,
        title: tab.title,
        timestamp: Date.now(),
        data: response.metadata,
      });
      await chrome.storage.local.set({ [CAPTURES_KEY]: captures.slice(0, 50) });
      showToast("Metadata extracted: " + (response.metadata.frameworks?.join(", ") || "page info"));
    }
  } catch (e) {
    showToast("Could not extract (reload page first)");
  }
});

document.getElementById("new-project").addEventListener("click", async () => {
  const url = await getAtlasUrl();
  chrome.tabs.create({ url: url + "?intent=new-project" });
  window.close();
});

// ── Captures tab ──
function loadCaptures() {
  chrome.storage.local.get(CAPTURES_KEY, (result) => {
    const captures = result[CAPTURES_KEY] || [];
    const container = document.getElementById("captures-list");

    if (captures.length === 0) {
      container.innerHTML = '<div class="empty-state">No captures yet — use ⌘⇧C or right-click</div>';
      return;
    }

    container.innerHTML = captures.slice(0, 20).map((c, i) => `
      <div class="capture-item" data-index="${i}">
        <span class="dot ${c.type}"></span>
        <span class="name" title="${esc(c.url)}">${esc(c.title || c.url || "Untitled")}</span>
        <span class="time">${timeAgo(c.timestamp)}</span>
      </div>
    `).join("");

    // Click to open in Atlas with context
    container.querySelectorAll(".capture-item").forEach((el) => {
      el.addEventListener("click", async () => {
        const idx = parseInt(el.dataset.index);
        const capture = captures[idx];
        const url = await getAtlasUrl();
        const params = new URLSearchParams({ capture: JSON.stringify(capture) });
        chrome.tabs.create({ url: url + "?" + params.toString() });
        window.close();
      });
    });
  });
}

document.getElementById("clear-captures").addEventListener("click", async () => {
  await chrome.storage.local.set({ [CAPTURES_KEY]: [] });
  loadCaptures();
  showToast("Captures cleared");
});

// ── Projects tab ──
function loadProjects() {
  chrome.storage.local.get(RECENTS_KEY, (result) => {
    const recents = result[RECENTS_KEY] || [];
    const container = document.getElementById("recents");

    if (recents.length === 0) {
      container.innerHTML = '<div class="empty-state">No recent projects</div>';
      return;
    }

    container.innerHTML = recents.slice(0, 8).map((project) => `
      <div class="recent" data-id="${project.id}">
        <span class="dot page"></span>
        <span class="name">${esc(project.name)}</span>
        <span class="time">${timeAgo(project.lastOpened)}</span>
      </div>
    `).join("");

    container.querySelectorAll(".recent").forEach((el) => {
      el.addEventListener("click", async () => {
        const url = await getAtlasUrl();
        chrome.tabs.create({ url: url + "?project=" + el.dataset.id });
        window.close();
      });
    });
  });
}

// ── Settings ──
document.getElementById("settings-link").addEventListener("click", (e) => {
  e.preventDefault();
  const url = prompt("Atlas IDE URL:", DEFAULT_URL);
  if (url) chrome.storage.local.set({ [ATLAS_URL_KEY]: url });
});

document.getElementById("help-link").addEventListener("click", (e) => {
  e.preventDefault();
  alert(
    "Atlas IDE Shortcuts:\n\n" +
    "⌘⇧A — Open Atlas IDE\n" +
    "⌘⇧C — Quick capture page\n\n" +
    "Right-click any text, image, or link to send it to Atlas.\n\n" +
    "In Atlas IDE:\n" +
    "⌘B — Toggle chat\n" +
    "⌘⇧B — Build\n" +
    "⌘⇧Enter — Run\n" +
    "⌘` — Console\n" +
    "⌘E — File tree\n" +
    "⌘\\ — Full canvas\n" +
    "⌘/ — Shortcuts"
  );
});

// ── Helpers ──
function showToast(msg) {
  const toast = document.getElementById("capture-status");
  document.getElementById("capture-message").textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2500);
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return mins + "m";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h";
  return Math.floor(hrs / 24) + "d";
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

// ── Diff tab ──
let diffHasResult = false;

function runDiff() {
  const oldCode = document.getElementById("diff-old").value;
  const newCode = document.getElementById("diff-new").value;
  if (!oldCode && !newCode) { showToast("Paste code in both panes"); return; }

  const oldLines = oldCode.split("\n");
  const newLines = newCode.split("\n");
  const result = document.getElementById("diff-result");
  let html = "";
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const ol = oldLines[i] ?? "";
    const nl = newLines[i] ?? "";
    if (ol === nl) {
      html += `<div style="opacity:0.4;padding:0 4px;">&nbsp;${esc(ol)}</div>`;
    } else {
      if (ol) html += `<div style="color:rgba(248,113,113,0.8);background:rgba(248,113,113,0.06);padding:0 4px;">-${esc(ol)}</div>`;
      if (nl) html += `<div style="color:rgba(74,222,128,0.8);background:rgba(74,222,128,0.06);padding:0 4px;">+${esc(nl)}</div>`;
    }
  }
  result.innerHTML = html || '<div style="opacity:0.3;">No differences</div>';
  diffHasResult = true;

  // Show accept/reject actions
  document.getElementById("diff-actions").style.display = "flex";

  // Store for later retrieval
  chrome.storage.local.set({ "atlas-pending-diff": { old: oldCode, new: newCode, timestamp: Date.now() } });
  showToast("Diff computed");
}

document.getElementById("run-diff").addEventListener("click", runDiff);

// Send diff to Atlas IDE
document.getElementById("send-diff-atlas").addEventListener("click", async () => {
  const oldCode = document.getElementById("diff-old").value;
  const newCode = document.getElementById("diff-new").value;
  if (!oldCode && !newCode) { showToast("Paste code first"); return; }
  chrome.storage.local.set({ "atlas-pending-diff": { old: oldCode, new: newCode, timestamp: Date.now() } });
  const url = await getAtlasUrl();
  const params = new URLSearchParams({ diffOld: oldCode.slice(0, 5000), diffNew: newCode.slice(0, 5000) });
  chrome.tabs.create({ url: url + "?" + params.toString() });
  window.close();
});

// Accept diff — keep "After" code, clear "Before"
document.getElementById("diff-accept").addEventListener("click", () => {
  const newCode = document.getElementById("diff-new").value;
  document.getElementById("diff-old").value = newCode;
  document.getElementById("diff-result").innerHTML = '<div style="opacity:0.3;color:rgba(74,222,128,0.6);">✓ Changes accepted</div>';
  document.getElementById("diff-actions").style.display = "none";
  chrome.storage.local.set({
    "atlas-diff-decision": { action: "accept", code: newCode, timestamp: Date.now() }
  });
  showToast("Changes accepted");
});

// Reject diff — keep "Before" code, revert "After"
document.getElementById("diff-reject").addEventListener("click", () => {
  const oldCode = document.getElementById("diff-old").value;
  document.getElementById("diff-new").value = oldCode;
  document.getElementById("diff-result").innerHTML = '<div style="opacity:0.3;color:rgba(248,113,113,0.6);">✗ Changes rejected</div>';
  document.getElementById("diff-actions").style.display = "none";
  chrome.storage.local.set({
    "atlas-diff-decision": { action: "reject", code: oldCode, timestamp: Date.now() }
  });
  showToast("Changes rejected — reverted to original");
});

// Load projects on init
loadProjects();
