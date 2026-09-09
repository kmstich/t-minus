const KEY_STATE = "tminus.state";
const KEY_SESSION = "tminus.session";
const KEY_TOKEN = "tminus.token";

const STEPS = [
  {
    title: "Welcome! What's your name?",
    lede: "This is so T-Minus can put a name to the project and send you updates to comments.",
  },
  {
    title: "First, we'll need access to your GitHub repo.",
    lede: "This is so T-Minus can display your prototype and write comments.",
  },
  {
    title: "Next, make sure we're pointed at the right build.",
    lede: "This is the prototype people will actually comment on, so make sure it's the right one!",
  },
  {
    title: "What's the name of the screen or flow?",
    lede: "This is just to orient reviewers to the experience they are looking at.",
  },
  {
    title: "When do you need feedback by?",
    lede: "This is the last day for reviewers to provide feedback.",
  },
  {
    title: "What kind of feedback are you looking for?",
    lede: "This will appear as a comment thread for quick reference.",
  },
  {
    title: "Ready to share?",
    lede: "Once you're ready, hit \"Open Review\" to launch the comment canvas.",
  },
];

const defaultTZero = () => {
  const d = new Date();
  d.setDate(d.getDate() + 6);
  return d.toISOString();
};

const blankState = () => ({
  created: false,
  creator: { name: "", email: "" },
  review: {
    repo: "",
    repoConnected: false,
    resolvedKind: null, // 'html' | 'source' | null
    resolvedPath: "",
    resolvedHtml: "",
    resolvedSource: "",
    url: "",
    title: "",
    tzero: defaultTZero(),
    brief: "",
    briefAreas: [],
    slug: "",
  },
  comments: [],
  votes: {},
  showResolved: false,
});

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

let state = { ...blankState(), ...read(KEY_STATE, {}) };
let session = read(KEY_SESSION, null);
let githubToken = "";
try {
  githubToken = localStorage.getItem(KEY_TOKEN) || "";
} catch {
  githubToken = "";
}
let step = 1;
let mode = "interact";
let anchor = null;
let composerTags = [];

const save = () => localStorage.setItem(KEY_STATE, JSON.stringify(state));
const $ = (sel) => document.querySelector(sel);

const el = {
  stepIndex: $("#step-index"),
  stepTitle: $("#step-title"),
  stepLede: $("#step-lede"),
  progress: $("#progress-fill"),
  steps: [...document.querySelectorAll(".step")],

  inCreatorName: $("#in-creator-name"),
  inCreatorEmail: $("#in-creator-email"),
  inRepo: $("#in-repo"),
  resolveStatus: $("#resolve-status"),
  resolveRepoLabel: $("#resolve-repo-label"),
  resolveNote: $("#resolve-note"),
  btnResolve: $("#btn-resolve"),
  inTitle: $("#in-title"),
  inTzero: $("#in-tzero"),
  briefChecklist: $("#brief-checklist"),
  addBriefField: $("#add-brief-field"),
  summary: $("#summary-spec"),
  summaryTitle: $("#summary-title"),
  summaryFocusList: $("#summary-focus-list"),
  btnBack: $("#btn-back"),
  btnNext: $("#btn-next"),
  error: $("#wizard-error"),

  screenOnboarding: $("#screen-onboarding"),
  screenWorkspace: $("#screen-workspace"),

  canvas: $("#canvas"),
  protoFrame: $("#proto-frame"),
  overlay: $("#overlay"),
  pinLayer: $("#pin-layer"),
  frameFallback: $("#frame-fallback"),
  frameFallbackTitle: $("#frame-fallback-title"),
  frameFallbackBody: $("#frame-fallback-body"),
  frameFallbackLink: $("#frame-fallback-link"),
  sourceView: $("#source-view"),
  sourceCode: $("#source-code"),
  countdown: $("#countdown"),

  reviewTitle: $("#review-title"),
  hamburgerBtn: $("#hamburger-btn"),
  commentsHeading: $("#comments-heading"),
  threads: $("#threads"),
  readyToLaunch: $("#ready-to-launch"),

  menuModal: $("#menu-modal"),
  closeMenu: $("#close-menu"),
  modeInteract: $("#mode-interact"),
  modeComment: $("#mode-comment"),
  who: $("#who"),
  newSession: $("#new-session"),
  toggleResolved: $("#toggle-resolved"),
  editDetailsBtn: $("#edit-details"),
  newReview: $("#new-review"),

  detailsPanel: $("#details-panel"),
  closeDetails: $("#close-details"),
  detailsEdit: $("#details-edit"),
  editRepo: $("#edit-repo"),
  editResolveBtn: $("#edit-resolve"),
  editResolveStatus: $("#edit-resolve-status"),
  editToken: $("#edit-token"),
  syncStatusLabel: $("#sync-status-label"),
  editUrl: $("#edit-url"),
  editUrlWarning: $("#edit-url-warning"),
  editTitle: $("#edit-title"),
  editTzero: $("#edit-tzero"),
  editBriefChecklist: $("#edit-brief-checklist"),
  editAddBriefField: $("#edit-add-brief-field"),
  cancelEditDetails: $("#cancel-edit-details"),

  goModal: $("#go-modal"),
  closeGo: $("#close-go"),
  voteGo: $("#vote-go"),
  voteNoGo: $("#vote-nogo"),
  statOpen: $("#stat-open"),
  statBlockers: $("#stat-blockers"),
  statVotes: $("#stat-votes"),

  composer: $("#composer"),
  anchorLabel: $("#anchor-label"),
  commentBody: $("#comment-body"),
  commentBlocker: $("#comment-blocker"),
  composerTagOptions: $("#composer-tag-options"),
  composerTagInput: $("#composer-tag-input"),
  composerTagAdd: $("#composer-tag-add"),
  composerCancel: $("#composer-cancel"),

  gate: $("#gate"),
  gateForm: $("#gate-form"),
  gateMeta: $("#gate-meta"),
  inName: $("#in-name"),
  tpl: $("#tpl-thread"),
};

/* ---------- formatting ---------- */

const toDateInput = (iso) => new Date(iso).toISOString().slice(0, 10);

const expiryDate = (iso) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + 60);
  return d;
};

const shortDate = (d) =>
  d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const countdown = (iso) => {
  const delta = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(delta);
  const totalSeconds = Math.floor(abs / 1000);
  const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${delta < 0 ? "+" : ""}${hh}:${mm}:${ss}`;
};

const relativeTime = (iso) => {
  const deltaMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(deltaMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
};

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "review";

/* ---------- author avatar colors (exact 5-color palette) ---------- */

const AVATAR_COLORS = ["#00b460", "#4400ff", "#009dd2", "#ffae0d", "#e30039"];

const authorColor = (name) => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
};

/* ---------- feedback focus checklist (user-authored, 5–20 fields) ---------- */

const BRIEF_FIELDS_MIN = 5;
const BRIEF_FIELDS_MAX = 20;

const TRASH_ICON =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5V13a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V4.5M6.5 7v4M9.5 7v4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const briefFieldRow = (value) => {
  const row = document.createElement("div");
  row.className = "checklist-item";

  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.maxLength = 140;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-field";
  remove.innerHTML = TRASH_ICON;
  remove.setAttribute("aria-label", "remove field");

  row.append(input, remove);
  return row;
};

const ADD_FIELD_ICON =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor"/><path d="M8 4.5v7M4.5 8h7" stroke="currentColor" stroke-linecap="round"/></svg>';

const updateAddButtonState = (container, addButton) => {
  const count = container.children.length;
  const atMax = count >= BRIEF_FIELDS_MAX;
  addButton.disabled = atMax;

  if (addButton.id === "add-brief-field") {
    addButton.innerHTML = atMax ? `Maximum ${BRIEF_FIELDS_MAX} reached` : `${ADD_FIELD_ICON}Add focus area`;
  } else {
    addButton.textContent = atMax ? `Maximum ${BRIEF_FIELDS_MAX} reached` : "+ Add another";
  }
};

const initBriefFields = (container, addButton, values) => {
  container.innerHTML = "";

  const seed = values && values.length ? values.slice() : [];
  while (seed.length < BRIEF_FIELDS_MIN) seed.push("");

  seed.forEach((value) => container.appendChild(briefFieldRow(value)));
  updateAddButtonState(container, addButton);

  container.querySelectorAll(".remove-field").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".checklist-item").remove();
      updateAddButtonState(container, addButton);
    });
  });

  addButton.onclick = () => {
    if (container.children.length >= BRIEF_FIELDS_MAX) return;
    const row = briefFieldRow("");
    row.querySelector(".remove-field").addEventListener("click", () => {
      row.remove();
      updateAddButtonState(container, addButton);
    });
    container.appendChild(row);
    updateAddButtonState(container, addButton);
    row.querySelector("input").focus();
  };
};

const getBriefFieldValues = (container) =>
  [...container.querySelectorAll("input[type=text]")]
    .map((i) => i.value.trim())
    .filter(Boolean);

const formatBrief = (items) => (items.length ? `Focus areas: ${items.join(", ")}` : "");

/* ---------- comment tags ---------- */

const TAG_LIBRARY = [
  { id: "a11y", label: "A11y", color: "#2F6FED" },
  { id: "ux", label: "UX", color: "#1FA463" },
  { id: "visual-design", label: "Visual design", color: "#8B5CF6" },
  { id: "business-review", label: "Business review", color: "#F2942B" },
  { id: "design-system", label: "Design system", color: "#E23FA0" },
  { id: "content", label: "Content", color: "#2BB3B3" },
  { id: "bug", label: "Bug", color: "#E5484D" },
];

const makeCustomTag = (label) => ({
  id: `custom-${slugify(label)}-${Date.now().toString(36)}`,
  label,
  color: null,
});

const createTagChip = (tag, { asButton = false, removable = false, onRemove, isOn = true } = {}) => {
  const chip = document.createElement(asButton ? "button" : "span");
  if (asButton) chip.type = "button";
  chip.className = "tag-chip";
  chip.classList.toggle("is-on", isOn);
  if (tag.color) chip.style.setProperty("--tag-color", tag.color);
  chip.append(document.createTextNode(tag.label));

  if (removable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "tag-chip-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `remove ${tag.label} tag`);
    remove.addEventListener("click", (e) => {
      e.stopPropagation();
      onRemove?.();
    });
    chip.appendChild(remove);
  }

  return chip;
};

const renderTagOptions = (container, tags, onToggle) => {
  container.innerHTML = "";
  TAG_LIBRARY.forEach((tag) => {
    const isOn = tags.some((t) => t.id === tag.id);
    const chip = createTagChip(tag, { asButton: true, isOn });
    chip.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggle(tag);
    });
    container.appendChild(chip);
  });
};

const renderTagList = (container, tags, { removable = false, onRemove } = {}) => {
  container.innerHTML = "";
  tags.forEach((tag) => {
    container.appendChild(createTagChip(tag, { removable, onRemove: () => onRemove?.(tag) }));
  });
};

const wireCustomTagAdd = (input, button, onAdd) => {
  const submit = (e) => {
    e?.preventDefault();
    e?.stopPropagation();
    const label = input.value.trim();
    if (!label) return;
    onAdd(makeCustomTag(label));
    input.value = "";
    input.focus();
  };
  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit(e);
  });
};

/* ---------- repository entry-file resolution ----------
 * Uses api.github.com and raw.githubusercontent.com directly from the
 * browser — both send permissive CORS headers for public repos, so this
 * works without any backend. It can only ever go as far as the browser
 * itself can run: index.html renders directly; App.tsx (or any TSX/JSX)
 * is TypeScript+JSX source and cannot execute without a build step, so
 * it's shown as read-only text instead of pretending to run it.
 */

const looksLikeGithubRepoPage = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === "github.com" || hostname === "www.github.com";
  } catch {
    return false;
  }
};

const parseGithubRepo = (input) => {
  try {
    const u = new URL(input.trim());
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/i, "") };
  } catch {
    return null;
  }
};

const ghContents = async (owner, repo, path = "") => {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
};

const findEntryFile = async (owner, repo) => {
  const matchIn = (list, names) =>
    Array.isArray(list) ? list.find((it) => it.type === "file" && names.includes(it.name.toLowerCase())) : null;
  const dirNamed = (list, name) =>
    Array.isArray(list) ? list.find((it) => it.type === "dir" && it.name.toLowerCase() === name) : null;

  const root = await ghContents(owner, repo);
  if (!root) throw new Error("Repository not found");

  let hit = matchIn(root, ["index.html"]);
  if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };

  for (const dirName of ["public", "dist", "build"]) {
    const dir = dirNamed(root, dirName);
    if (!dir) continue;
    const listing = await ghContents(owner, repo, dir.path);
    hit = matchIn(listing, ["index.html"]);
    if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };
  }

  hit = matchIn(root, ["app.tsx", "app.jsx"]);
  if (hit) return { kind: "source", path: hit.path, downloadUrl: hit.download_url };

  const src = dirNamed(root, "src");
  if (src) {
    const listing = await ghContents(owner, repo, src.path);
    hit = matchIn(listing, ["index.html"]);
    if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };
    hit = matchIn(listing, ["app.tsx", "app.jsx"]);
    if (hit) return { kind: "source", path: hit.path, downloadUrl: hit.download_url };
  }

  return null;
};

const resolveEntryFromRepo = async (repoInput) => {
  const parsed = parseGithubRepo(repoInput);
  if (!parsed) return { error: "Not a valid GitHub repository URL" };

  let entry;
  try {
    entry = await findEntryFile(parsed.owner, parsed.repo);
  } catch (err) {
    return { error: `GitHub lookup failed — ${err.message}` };
  }

  if (!entry) {
    return {
      error:
        "No entry file found. Looked for index.html at the root (or /public, /dist, /build) and App.tsx at the root or /src. Rename or move your entry file to match.",
    };
  }

  const fileRes = await fetch(entry.downloadUrl);
  if (!fileRes.ok) return { error: `Could not fetch ${entry.path}` };
  const text = await fileRes.text();

  if (entry.kind === "html") {
    const rawDir = entry.downloadUrl.slice(0, entry.downloadUrl.lastIndexOf("/") + 1);
    const html = /<base[\s>]/i.test(text)
      ? text
      : text.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<base href="${rawDir}">`);
    return { kind: "html", path: entry.path, html };
  }

  return { kind: "source", path: entry.path, source: text };
};

/* ---------- writing comments back to the repo ----------
 * Optional and opt-in, configured only from the workspace's Details
 * panel (not the wizard). Without a token, everything stays in this
 * browser's localStorage only. With a token, comments and votes are
 * written as a single JSON snapshot file to a dedicated
 * "tminus-<slug>" branch, so main/production branches are never
 * touched. The token itself is stored only in localStorage and sent
 * directly from this browser to api.github.com — there is no T-Minus
 * server to route it through or hide it behind. That's a real
 * tradeoff, stated here rather than hidden.
 */

const setGithubToken = (token) => {
  githubToken = token || "";
  try {
    if (githubToken) localStorage.setItem(KEY_TOKEN, githubToken);
    else localStorage.removeItem(KEY_TOKEN);
  } catch {
    // localStorage unavailable — token still works for this page load
  }
};

const b64EncodeUnicode = (str) =>
  btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(`0x${hex}`)));

const ghAuthFetch = async (path, token, options = {}) => {
  const res = await fetch(`https://api.github.com/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${token}`,
      ...(options.headers || {}),
    },
  });
  return res;
};

const verifyRepoAccess = async (owner, repo, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}`, token);
  if (res.status === 401 || res.status === 403) throw new Error("Token was rejected — check it's valid and has repo access");
  if (res.status === 404) throw new Error("Repository not found with this token — check the URL and token scope");
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
};

const getBranchSha = async (owner, repo, branch, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  return json.object?.sha || null;
};

const createBranch = async (owner, repo, branch, fromSha, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/git/refs`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: fromSha }),
  });
  if (!res.ok) throw new Error(`Could not create branch (${res.status})`);
};

const ensureSyncBranch = async (owner, repo, slug, token) => {
  const branch = `tminus-${slug}`;
  const existing = await getBranchSha(owner, repo, branch, token);
  if (existing) return branch;
  const repoInfo = await verifyRepoAccess(owner, repo, token);
  const baseSha = await getBranchSha(owner, repo, repoInfo.default_branch, token);
  if (!baseSha) throw new Error("Could not read default branch");
  await createBranch(owner, repo, branch, baseSha, token);
  return branch;
};

const getFileSha = async (owner, repo, path, branch, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  return json.sha || null;
};

const putFile = async (owner, repo, path, branch, content, message, sha, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/contents/${path}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, branch, content: b64EncodeUnicode(content), ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `GitHub API ${res.status}`);
  }
  return res.json();
};

let syncTimer = null;
let syncStatus = "idle"; // idle | pending | syncing | synced | error | nocreds
let syncMessage = "";

const updateSyncUI = () => {
  if (!el.syncStatusLabel) return;
  el.syncStatusLabel.classList.remove("is-synced", "is-error");

  if (syncStatus === "nocreds") el.syncStatusLabel.textContent = "Local only — no token";
  else if (syncStatus === "pending") el.syncStatusLabel.textContent = "Sync pending…";
  else if (syncStatus === "syncing") el.syncStatusLabel.textContent = "Syncing…";
  else if (syncStatus === "synced") {
    el.syncStatusLabel.textContent = `Synced · ${syncMessage}`;
    el.syncStatusLabel.classList.add("is-synced");
  } else if (syncStatus === "error") {
    el.syncStatusLabel.textContent = `Sync failed — ${syncMessage}`;
    el.syncStatusLabel.classList.add("is-error");
  } else {
    el.syncStatusLabel.textContent = "Not synced yet";
  }
};

const runSync = async () => {
  if (!githubToken || !state.review.repoConnected || !state.review.repo) {
    syncStatus = "nocreds";
    updateSyncUI();
    return;
  }

  syncStatus = "syncing";
  updateSyncUI();

  try {
    const parsed = parseGithubRepo(state.review.repo);
    if (!parsed) throw new Error("Invalid repository URL");

    const slug = state.review.slug || slugify(state.review.title || "review");
    const branch = await ensureSyncBranch(parsed.owner, parsed.repo, slug, githubToken);
    const path = `.tminus/${slug}/comments.json`;

    const payload = JSON.stringify(
      { review: state.review.title, updatedAt: new Date().toISOString(), comments: state.comments, votes: state.votes },
      null,
      2,
    );

    const existingSha = await getFileSha(parsed.owner, parsed.repo, path, branch, githubToken);
    await putFile(
      parsed.owner,
      parsed.repo,
      path,
      branch,
      payload,
      `T-Minus: update comments (${state.comments.length} total)`,
      existingSha,
      githubToken,
    );

    syncStatus = "synced";
    syncMessage = `${path} on ${branch}`;
  } catch (err) {
    syncStatus = "error";
    syncMessage = err.message;
  } finally {
    updateSyncUI();
  }
};

const scheduleSync = () => {
  if (!githubToken || !state.review.repoConnected) {
    syncStatus = "nocreds";
    updateSyncUI();
    return;
  }
  syncStatus = "pending";
  updateSyncUI();
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 1200);
};

/* ---------- wizard: step 2, repo access (single-button, no visible
   status text or token field — token is configured later from the
   workspace Details panel only) ---------- */

el.inRepo.addEventListener("input", () => {
  state.review.repoConnected = false;
});

/* ---------- wizard: step 3, resolve entry file ---------- */

const renderResolveStatus = () => {
  if (state.review.resolvedKind === "html") {
    el.resolveStatus.textContent = state.review.resolvedPath;
    el.resolveNote.classList.add("is-hidden");
  } else if (state.review.resolvedKind === "source") {
    el.resolveStatus.textContent = `${state.review.resolvedPath} (source only)`;
    el.resolveNote.textContent =
      "This is TypeScript/JSX source. It cannot execute in a browser without a build step, so it will be shown as read-only code, not a running app.";
    el.resolveNote.classList.remove("is-hidden");
  } else {
    el.resolveStatus.textContent = "Not resolved";
  }
};

const runResolve = async (repoValue) => {
  el.btnResolve.disabled = true;
  el.resolveStatus.textContent = "Searching…";
  el.resolveNote.classList.add("is-hidden");

  try {
    const result = await resolveEntryFromRepo(repoValue);
    if (result.error) {
      state.review.resolvedKind = null;
      state.review.resolvedPath = "";
      state.review.resolvedHtml = "";
      state.review.resolvedSource = "";
      el.resolveStatus.textContent = "Not resolved";
      el.resolveNote.textContent = result.error;
      el.resolveNote.classList.remove("is-hidden");
    } else {
      state.review.resolvedKind = result.kind;
      state.review.resolvedPath = result.path;
      state.review.resolvedHtml = result.kind === "html" ? result.html : "";
      state.review.resolvedSource = result.kind === "source" ? result.source : "";
      renderResolveStatus();
    }
  } catch (err) {
    el.resolveStatus.textContent = "Not resolved";
    el.resolveNote.textContent = `Unexpected error — ${err.message}`;
    el.resolveNote.classList.remove("is-hidden");
  } finally {
    el.btnResolve.disabled = false;
    save();
  }
};

el.btnResolve.addEventListener("click", () => {
  const repo = state.review.repo || el.inRepo.value.trim();
  if (!repo) {
    el.resolveStatus.textContent = "Not resolved";
    el.resolveNote.textContent = "Connect a repository in the previous step first.";
    el.resolveNote.classList.remove("is-hidden");
    return;
  }
  runResolve(repo);
});

/* ---------- wizard flow ---------- */

const goToStep = (n) => {
  step = n;
  renderStep();
};

const stepValue = () =>
  ({
    1: el.inCreatorName.value.trim() && el.inCreatorEmail.value.trim() ? "ok" : "",
    2: state.review.repo.trim() ? "ok" : "",
    3: state.review.resolvedKind ? "ok" : "",
    4: el.inTitle.value.trim(),
    5: el.inTzero.value.trim(),
    6: getBriefFieldValues(el.briefChecklist).length ? "ok" : "",
    7: "ok",
  })[step];

const CHECK_ICON =
  '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const specRow = (label, value, { isLink = false, onEdit } = {}) => {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;

  const valueSpan = document.createElement("span");
  valueSpan.className = `value${isLink ? " is-link" : ""}`;
  valueSpan.textContent = value;
  dd.appendChild(valueSpan);

  if (onEdit) {
    const editLink = document.createElement("button");
    editLink.type = "button";
    editLink.className = "link action-link";
    editLink.textContent = "Edit";
    editLink.addEventListener("click", onEdit);
    dd.appendChild(editLink);
  }

  row.append(dt, dd);
  return row;
};

const renderSummary = () => {
  el.summaryTitle.textContent = state.review.title || "Review";

  const prototypeValue = state.review.resolvedKind ? state.review.resolvedPath : state.review.url || "—";

  el.summary.innerHTML = "";
  el.summary.appendChild(specRow("Repo", state.review.repo || "—", { isLink: true, onEdit: () => goToStep(2) }));
  el.summary.appendChild(specRow("Prototype", prototypeValue, { onEdit: () => goToStep(3) }));
  el.summary.appendChild(specRow("T-Zero", shortDate(new Date(state.review.tzero)), { onEdit: () => goToStep(5) }));

  el.summaryFocusList.innerHTML = "";
  (state.review.briefAreas || []).forEach((item) => {
    const li = document.createElement("li");
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.innerHTML = CHECK_ICON;
    li.append(icon, document.createTextNode(item));
    el.summaryFocusList.appendChild(li);
  });
};

const renderStep = () => {
  const meta = STEPS[step - 1];
  el.stepIndex.textContent = `Step ${step} / ${STEPS.length}`;
  el.stepTitle.textContent = meta.title;
  el.stepLede.textContent = meta.lede;
  el.progress.style.width = `${(step / STEPS.length) * 100}%`;
  el.error.textContent = "";

  el.steps.forEach((node) => node.classList.toggle("is-active", Number(node.dataset.step) === step));
  el.btnBack.classList.toggle("is-hidden", step === 1);
  el.btnNext.textContent = step === STEPS.length ? "Open Review" : "Continue";

  if (step === 3) renderResolveStatus();
  if (step === STEPS.length) renderSummary();
};

const commitStep = () => {
  if (step === 1) {
    state.creator.name = el.inCreatorName.value.trim();
    state.creator.email = el.inCreatorEmail.value.trim();
  }
  if (step === 2) state.review.repo = el.inRepo.value.trim();
  if (step === 4) state.review.title = el.inTitle.value.trim();
  if (step === 5) state.review.tzero = new Date(el.inTzero.value).toISOString();
  if (step === 6) {
    state.review.briefAreas = getBriefFieldValues(el.briefChecklist);
    state.review.brief = formatBrief(state.review.briefAreas);
  }
  save();
};

el.btnNext.addEventListener("click", () => {
  if (step === 2 && el.inRepo.value.trim()) state.review.repoConnected = true;

  if (!stepValue()) {
    el.error.textContent =
      step === 1
        ? "Name and email are required"
        : step === 2
          ? "Enter a repository to continue"
          : step === 3
            ? "Find a build before continuing"
            : "Required";
    return;
  }

  commitStep();

  if (step < STEPS.length) {
    step += 1;
    renderStep();
    return;
  }

  state.created = true;
  state.review.slug = slugify(state.review.title);
  save();
  openWorkspace();
});

el.btnBack.addEventListener("click", () => {
  if (step === 1) return;
  step -= 1;
  renderStep();
});

/* ---------- workspace ---------- */

const counts = () => ({
  open: state.comments.filter((c) => !c.resolved).length,
  blockers: state.comments.filter((c) => !c.resolved && c.blocker).length,
  go: Object.values(state.votes).filter((v) => v === "go").length,
  nogo: Object.values(state.votes).filter((v) => v === "nogo").length,
});

const visible = () => state.comments.filter((c) => state.showResolved || !c.resolved);

const renderComposerTags = () => {
  renderTagOptions(el.composerTagOptions, composerTags, (tag) => {
    const idx = composerTags.findIndex((t) => t.id === tag.id);
    if (idx === -1) composerTags.push(tag);
    else composerTags.splice(idx, 1);
    renderComposerTags();
  });
};

wireCustomTagAdd(el.composerTagInput, el.composerTagAdd, (tag) => {
  composerTags.push(tag);
  renderComposerTags();
});

const closeComposer = () => {
  anchor = null;
  el.composer.classList.add("is-hidden");
  el.commentBody.value = "";
  el.commentBlocker.checked = false;
  el.anchorLabel.textContent = "—";
  composerTags = [];
  renderComposerTags();
  removeGuide();
};

const renderPins = () => {
  el.pinLayer.innerHTML = "";
  visible().forEach((c) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `pin-dot${c.blocker ? " is-blocker" : ""}`;
    dot.style.setProperty("--pin-color", authorColor(c.author));
    dot.style.left = `${c.x * 100}%`;
    dot.style.top = `${c.y * 100}%`;
    dot.textContent = c.author.charAt(0).toUpperCase();
    dot.title = c.body;
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      const node = el.threads.querySelector(`[data-comment-id="${c.id}"]`);
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
      node?.querySelector(".thread-detail")?.classList.remove("is-hidden");
    });
    el.pinLayer.appendChild(dot);
  });
};

const renderThreads = () => {
  el.threads.innerHTML = "";
  const list = visible();
  const n = counts();
  el.commentsHeading.textContent = `Comments (${list.length + 1})`;

  // synthetic pinned entry surfacing the review brief, authored by the
  // creator — not a real comment, always shown first
  const pinned = document.createElement("article");
  pinned.className = "thread is-pinned";
  const pinnedAvatar = document.createElement("span");
  pinnedAvatar.className = "avatar";
  pinnedAvatar.style.setProperty("--avatar-color", authorColor(state.creator.name || "T"));
  pinnedAvatar.textContent = (state.creator.name || "T").charAt(0).toUpperCase();
  const pinnedTop = document.createElement("div");
  pinnedTop.className = "thread-top";
  const pinnedAuthor = document.createElement("p");
  pinnedAuthor.className = "thread-author";
  pinnedAuthor.textContent = state.creator.name || "Creator";
  const pinnedMeta = document.createElement("span");
  pinnedMeta.className = "thread-meta";
  pinnedMeta.textContent = "📌 Pinned";
  pinnedTop.append(pinnedAvatar, pinnedAuthor, pinnedMeta);
  const pinnedBody = document.createElement("p");
  pinnedBody.className = "thread-body";
  pinnedBody.textContent = state.review.brief || "Focus areas: —";
  pinned.append(pinnedTop, pinnedBody);
  el.threads.appendChild(pinned);

  list.forEach((c) => {
    c.tags = c.tags || [];

    const node = el.tpl.content.cloneNode(true);
    const article = node.querySelector(".thread");
    article.dataset.commentId = c.id;

    const avatar = node.querySelector(".avatar");
    avatar.style.setProperty("--avatar-color", authorColor(c.author));
    avatar.textContent = c.author.charAt(0).toUpperCase();

    node.querySelector(".thread-author").textContent = c.author;
    node.querySelector(".thread-meta").textContent = c.resolved
      ? `${relativeTime(c.createdAt)} · resolved`
      : c.blocker
        ? `${relativeTime(c.createdAt)} · blocker`
        : relativeTime(c.createdAt);
    node.querySelector(".thread-body").textContent = c.body;

    const detail = node.querySelector(".thread-detail");
    const threadTags = node.querySelector(".thread-tags");
    const tagPicker = node.querySelector(".tag-picker");
    const tagOptions = tagPicker.querySelector(".tag-options");
    const tagInput = tagPicker.querySelector(".tag-add-row input");
    const tagAddBtn = tagPicker.querySelector(".tag-add-btn");
    const actTagToggle = node.querySelector(".act-tag-toggle");
    const replyForm = node.querySelector(".reply-form");
    const replyInput = replyForm.querySelector("input");
    const replies = node.querySelector(".replies");
    const actReply = node.querySelector(".act-reply");
    const actResolve = node.querySelector(".act-resolve");

    article.addEventListener("click", () => detail.classList.toggle("is-hidden"));
    [replyForm, tagPicker].forEach((el2) => el2.addEventListener("click", (e) => e.stopPropagation()));

    const refreshTags = () => {
      renderTagList(threadTags, c.tags, {
        removable: true,
        onRemove: (t) => {
          c.tags = c.tags.filter((existing) => existing.id !== t.id);
          save();
          scheduleSync();
          refreshTags();
        },
      });
      renderTagOptions(tagOptions, c.tags, (t) => {
        const idx = c.tags.findIndex((existing) => existing.id === t.id);
        if (idx === -1) c.tags.push(t);
        else c.tags.splice(idx, 1);
        save();
        scheduleSync();
        refreshTags();
      });
    };
    refreshTags();

    wireCustomTagAdd(tagInput, tagAddBtn, (t) => {
      c.tags.push(t);
      save();
      scheduleSync();
      refreshTags();
    });

    actTagToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      tagPicker.classList.toggle("is-hidden");
    });

    c.replies.forEach((r) => {
      const p = document.createElement("p");
      p.className = "reply";
      p.textContent = `${r.author}: ${r.body}`;
      replies.appendChild(p);
    });

    actReply.addEventListener("click", (e) => {
      e.stopPropagation();
      replyForm.classList.toggle("is-hidden");
      replyInput.focus();
    });

    replyForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const body = replyInput.value.trim();
      if (!body || !session) return;
      c.replies.push({ author: session.name, body });
      save();
      scheduleSync();
      renderWorkspace();
    });

    actResolve.textContent = c.resolved ? "Reopen" : "Resolve";
    actResolve.addEventListener("click", (e) => {
      e.stopPropagation();
      c.resolved = !c.resolved;
      save();
      scheduleSync();
      renderWorkspace();
    });

    el.threads.appendChild(node);
  });

  el.statOpen.textContent = n.open;
  el.statBlockers.textContent = n.blockers;
  el.statVotes.textContent = `${n.go} / ${n.nogo}`;
};

const renderWorkspace = () => {
  el.reviewTitle.textContent = state.review.title;
  el.countdown.textContent = countdown(state.review.tzero);
  el.who.textContent = session ? `Session / ${session.name}` : "No session";
  el.toggleResolved.textContent = state.showResolved ? "Hide resolved" : "Show resolved";
  el.voteGo.classList.toggle("is-on", !!session && state.votes[session.id] === "go");
  el.voteNoGo.classList.toggle("is-on", !!session && state.votes[session.id] === "nogo");

  renderPins();
  renderThreads();
};

const setMode = (next) => {
  mode = next;
  el.modeInteract.classList.toggle("is-on", next === "interact");
  el.modeComment.classList.toggle("is-on", next === "comment");
  el.canvas.classList.toggle("is-comment", next === "comment");
  if (next !== "comment") closeComposer();
};

/* ---------- prototype frame ---------- */

let frameLoaded = false;

const loadPrototype = (url) => {
  frameLoaded = false;
  el.frameFallbackTitle.textContent = "Prototype not reachable";
  el.frameFallbackBody.textContent =
    "The URL didn't load in a frame. It may block embedding, or it may not be a live, browser-accessible build.";
  el.frameFallbackLink.classList.remove("is-hidden");
  el.frameFallbackLink.href = url;
  el.frameFallback.classList.add("is-hidden");

  el.protoFrame.removeAttribute("srcdoc");
  el.protoFrame.src = url;

  window.setTimeout(() => {
    if (!frameLoaded) el.frameFallback.classList.remove("is-hidden");
  }, 4000);
};

el.protoFrame.addEventListener("load", () => {
  frameLoaded = true;
  el.frameFallback.classList.add("is-hidden");
});

el.protoFrame.addEventListener("error", () => {
  el.frameFallback.classList.remove("is-hidden");
});

const renderPrototypeSurface = () => {
  el.frameFallback.classList.add("is-hidden");
  el.sourceView.classList.add("is-hidden");
  el.protoFrame.classList.remove("is-hidden");

  const manualUrl = state.review.url;

  if (manualUrl) {
    loadPrototype(manualUrl);
    return;
  }

  if (state.review.resolvedKind === "html") {
    el.protoFrame.removeAttribute("src");
    el.protoFrame.srcdoc = state.review.resolvedHtml;
    return;
  }

  if (state.review.resolvedKind === "source") {
    el.protoFrame.classList.add("is-hidden");
    el.sourceCode.textContent = state.review.resolvedSource;
    el.sourceView.classList.remove("is-hidden");
    return;
  }

  el.protoFrame.classList.add("is-hidden");
  el.frameFallbackTitle.textContent = "Nothing to show yet";
  el.frameFallbackBody.textContent =
    "No entry file has been resolved and no deployed URL was provided. Open the menu to edit the repository.";
  el.frameFallbackLink.classList.add("is-hidden");
  el.frameFallback.classList.remove("is-hidden");
};

const openWorkspace = () => {
  el.screenOnboarding.classList.add("is-hidden");
  el.screenWorkspace.classList.remove("is-hidden");
  renderWorkspace();
  renderPrototypeSurface();

  if (!session) {
    el.gateMeta.textContent = `${state.review.title} / ${countdown(state.review.tzero)}`;
    el.gate.classList.remove("is-hidden");
    el.inName.focus();
  }
};

const resetToWizard = () => {
  state = blankState();
  save();
  el.menuModal.classList.add("is-hidden");
  el.detailsPanel.classList.add("is-hidden");
  el.goModal.classList.add("is-hidden");
  el.composer.classList.add("is-hidden");
  el.gate.classList.add("is-hidden");
  el.screenWorkspace.classList.add("is-hidden");
  el.screenOnboarding.classList.remove("is-hidden");

  el.inCreatorName.value = "";
  el.inCreatorEmail.value = "";
  el.inRepo.value = "";
  el.inTitle.value = "";
  el.inTzero.value = toDateInput(state.review.tzero);
  initBriefFields(el.briefChecklist, el.addBriefField, []);
  el.resolveNote.classList.add("is-hidden");
  el.resolveStatus.textContent = "Not resolved";

  step = 1;
  renderStep();
};

el.modeInteract.addEventListener("click", () => setMode("interact"));
el.modeComment.addEventListener("click", () => setMode("comment"));

/* ---------- hamburger menu ---------- */

el.hamburgerBtn.addEventListener("click", () => el.menuModal.classList.toggle("is-hidden"));
el.closeMenu.addEventListener("click", () => el.menuModal.classList.add("is-hidden"));
el.newReview.addEventListener("click", resetToWizard);

el.newSession.addEventListener("click", () => {
  session = null;
  localStorage.removeItem(KEY_SESSION);
  renderWorkspace();
  el.gateMeta.textContent = `${state.review.title} / ${countdown(state.review.tzero)}`;
  el.inName.value = "";
  el.gate.classList.remove("is-hidden");
  el.inName.focus();
});

el.toggleResolved.addEventListener("click", () => {
  state.showResolved = !state.showResolved;
  save();
  renderWorkspace();
});

/* ---------- details / edit panel ---------- */

const openDetailsEdit = () => {
  el.menuModal.classList.add("is-hidden");
  el.editRepo.value = state.review.repo;
  el.editUrl.value = state.review.url;
  el.editTitle.value = state.review.title;
  el.editTzero.value = toDateInput(state.review.tzero);
  initBriefFields(el.editBriefChecklist, el.editAddBriefField, state.review.briefAreas);
  el.editUrlWarning.classList.toggle("is-hidden", !looksLikeGithubRepoPage(el.editUrl.value));
  el.editResolveStatus.textContent = state.review.resolvedKind
    ? `Resolved — ${state.review.resolvedPath} (${state.review.resolvedKind === "html" ? "rendered" : "source only"})`
    : "Not resolved";
  el.editToken.value = "";
  updateSyncUI();
  el.detailsPanel.classList.remove("is-hidden");
};

el.editDetailsBtn.addEventListener("click", openDetailsEdit);
el.closeDetails.addEventListener("click", () => el.detailsPanel.classList.add("is-hidden"));
el.cancelEditDetails.addEventListener("click", () => el.detailsPanel.classList.add("is-hidden"));

el.editUrl.addEventListener("input", () => {
  el.editUrlWarning.classList.toggle("is-hidden", !looksLikeGithubRepoPage(el.editUrl.value));
});

el.editResolveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const repo = el.editRepo.value.trim();
  if (!repo) {
    el.editResolveStatus.textContent = "Enter a repository first";
    return;
  }

  el.editResolveStatus.textContent = "Searching…";
  const result = await resolveEntryFromRepo(repo);

  if (result.error) {
    state.review.resolvedKind = null;
    state.review.resolvedPath = "";
    state.review.resolvedHtml = "";
    state.review.resolvedSource = "";
    el.editResolveStatus.textContent = result.error;
  } else {
    state.review.resolvedKind = result.kind;
    state.review.resolvedPath = result.path;
    state.review.resolvedHtml = result.kind === "html" ? result.html : "";
    state.review.resolvedSource = result.kind === "source" ? result.source : "";
    el.editResolveStatus.textContent = `Resolved — ${result.path} (${result.kind === "html" ? "rendered" : "source only"})`;
  }

  save();
  if (!el.editUrl.value.trim()) renderPrototypeSurface();
});

el.detailsEdit.addEventListener("submit", async (e) => {
  e.preventDefault();

  const repo = el.editRepo.value.trim();
  const url = el.editUrl.value.trim();
  const title = el.editTitle.value.trim();
  const tzero = el.editTzero.value.trim();
  const briefAreas = getBriefFieldValues(el.editBriefChecklist);
  const newToken = el.editToken.value.trim();

  if (!repo || !title || !tzero || !briefAreas.length) return;
  if (!url && !state.review.resolvedKind) {
    el.editResolveStatus.textContent = "Resolve an entry file or provide a deployed URL";
    return;
  }

  if (newToken) {
    const parsed = parseGithubRepo(repo);
    if (parsed) {
      try {
        await verifyRepoAccess(parsed.owner, parsed.repo, newToken);
        setGithubToken(newToken);
      } catch (err) {
        el.editResolveStatus.textContent = err.message;
        return;
      }
    }
  }

  const surfaceChanged = url !== state.review.url;
  const repoChanged = repo !== state.review.repo;

  state.review.repo = repo;
  if (repoChanged) state.review.repoConnected = false;
  else state.review.repoConnected = true;
  state.review.url = url;
  state.review.title = title;
  state.review.tzero = new Date(tzero).toISOString();
  state.review.briefAreas = briefAreas;
  state.review.brief = formatBrief(briefAreas);
  state.review.slug = slugify(title);
  save();

  renderWorkspace();
  if (surfaceChanged) renderPrototypeSurface();
  scheduleSync();
  el.detailsPanel.classList.add("is-hidden");
});

/* ---------- go / no-go ---------- */

el.readyToLaunch.addEventListener("click", () => el.goModal.classList.remove("is-hidden"));
el.closeGo.addEventListener("click", () => el.goModal.classList.add("is-hidden"));

const vote = (value) => {
  if (!session) return;
  state.votes[session.id] = value;
  save();
  scheduleSync();
  renderWorkspace();
};

el.voteGo.addEventListener("click", () => vote("go"));
el.voteNoGo.addEventListener("click", () => vote("nogo"));

/* ---------- comment placement + composer ---------- */

el.overlay.addEventListener("mousemove", (e) => {
  if (mode !== "comment" || anchor) return;
  positionGuide(e);
});

el.overlay.addEventListener("mouseleave", () => removeGuide());

el.overlay.addEventListener("click", (e) => {
  if (mode !== "comment" || !session) return;
  if (e.target.classList.contains("pin-dot")) return;

  const rect = el.canvas.getBoundingClientRect();
  anchor = {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };

  removeGuide();
  el.anchorLabel.textContent = `${Math.round(anchor.x * 100)}, ${Math.round(anchor.y * 100)}`;
  composerTags = [];
  renderComposerTags();
  el.composer.classList.remove("is-hidden");
  el.commentBody.focus();
});

let guideEl = null;

const positionGuide = (e) => {
  const rect = el.canvas.getBoundingClientRect();
  if (!guideEl) {
    guideEl = document.createElement("span");
    guideEl.className = "crosshair-guide";
    el.pinLayer.appendChild(guideEl);
  }
  guideEl.style.left = `${e.clientX - rect.left}px`;
  guideEl.style.top = `${e.clientY - rect.top}px`;
};

const removeGuide = () => {
  guideEl?.remove();
  guideEl = null;
};

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = el.commentBody.value.trim();
  if (!body || !anchor || !session) return;

  state.comments.push({
    id: crypto.randomUUID(),
    author: session.name,
    body,
    blocker: el.commentBlocker.checked,
    tags: composerTags.map((t) => ({ ...t })),
    resolved: false,
    createdAt: new Date().toISOString(),
    replies: [],
    ...anchor,
  });

  save();
  scheduleSync();
  closeComposer();
  renderWorkspace();
});

el.composerCancel.addEventListener("click", closeComposer);

el.gateForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el.inName.value.trim();
  if (!name) return;
  session = { id: crypto.randomUUID(), name };
  localStorage.setItem(KEY_SESSION, JSON.stringify(session));
  el.gate.classList.add("is-hidden");
  renderWorkspace();
});

/* ---------- boot ---------- */

el.inCreatorName.value = state.creator.name;
el.inCreatorEmail.value = state.creator.email;
el.inRepo.value = state.review.repo;
el.inTitle.value = state.review.title;
el.inTzero.value = toDateInput(state.review.tzero);
initBriefFields(el.briefChecklist, el.addBriefField, state.review.briefAreas);
initBriefFields(el.editBriefChecklist, el.editAddBriefField, []);

renderComposerTags();
setMode("interact");

if (state.created) {
  openWorkspace();
} else {
  renderStep();
}

setInterval(() => {
  if (state.created) el.countdown.textContent = countdown(state.review.tzero);
}, 1000);
