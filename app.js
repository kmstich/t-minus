const KEY_STATE = "tminus.state";
const KEY_DEVICE_ID = "tminus.deviceId";
const KEY_TOKEN = "tminus.token";
const KEY_TOKEN_TOUCHED = "tminus.token.touched";

// How long an idle tab keeps holding the token before treating it as
// gone. sessionStorage already drops the token on its own the moment
// the tab/window closes or a new one opens — that's what makes "new
// session" wipe it for free. This idle clock covers the other half:
// someone who leaves a tab open and unattended shouldn't have it keep
// sitting there indefinitely with write access to their repo.
const TOKEN_IDLE_LIMIT_MS = 30 * 60 * 1000;

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
    // multi-page support: each page carries its own resolved
    // file/URL, same shape as the top-level resolved* fields above
    // (which stay in place for the wizard's single-file flow and get
    // folded into pages[0] the first time the workspace opens — see
    // ensurePages()). Comments reference a page by id.
    pages: [],
    activePageId: "",
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

// Whoever is using this browser already gave their name and email in
// step 1 of the wizard — that's true whether they're creating a new
// review or joining an existing one (step 2's "join" happens after
// step 1, never instead of it), so state.creator is already the
// right identity for authoring comments/replies. This id is only for
// keying this browser's own vote distinctly from anyone else's — it
// has no name attached and nothing ever asks for one.
let deviceId = localStorage.getItem(KEY_DEVICE_ID);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  localStorage.setItem(KEY_DEVICE_ID, deviceId);
}

// The token lives in sessionStorage, not localStorage: a hard refresh
// or a normal reload within the same tab both keep it (so someone
// mid-wizard who steps away for a minute or bumps refresh doesn't
// have to dig their token back out), but opening a fresh tab/window —
// a new session — starts with nothing, and the idle clock above clears
// it out of a tab that's been sitting untouched too long.
const readGithubToken = () => {
  try {
    const token = sessionStorage.getItem(KEY_TOKEN);
    if (!token) return "";
    const touchedAt = Number(sessionStorage.getItem(KEY_TOKEN_TOUCHED) || 0);
    if (Date.now() - touchedAt > TOKEN_IDLE_LIMIT_MS) {
      sessionStorage.removeItem(KEY_TOKEN);
      sessionStorage.removeItem(KEY_TOKEN_TOUCHED);
      return "";
    }
    return token;
  } catch {
    return "";
  }
};

let githubToken = readGithubToken();
let step = 1;
let mode = "interact";
let anchor = null;
let openThreadId = null;

const save = () => localStorage.setItem(KEY_STATE, JSON.stringify(state));
const $ = (sel) => document.querySelector(sel);

const el = {
  mastheadDate: $("#masthead-date"),
  stepIndex: $("#step-index"),
  stepTitle: $("#step-title"),
  stepLede: $("#step-lede"),
  progress: $("#progress-fill"),
  steps: [...document.querySelectorAll(".step")],

  inCreatorName: $("#in-creator-name"),
  inCreatorEmail: $("#in-creator-email"),
  inRepo: $("#in-repo"),
  inToken: $("#in-token"),
  tokenInfoToggle: $("#token-info-toggle"),
  tokenInfoModal: $("#token-info-modal"),
  tokenInfoClose: $("#token-info-close"),

  existingReviewModal: $("#existing-review-modal"),
  existingReviewClose: $("#existing-review-close"),
  existingReviewList: $("#existing-review-list"),
  existingReviewStartNew: $("#existing-review-start-new"),
  resolveStatus: $("#resolve-status"),
  resolveRepoLabel: $("#resolve-repo-label"),
  resolveNote: $("#resolve-note"),
  btnResolve: $("#btn-resolve"),

  filePickerModal: $("#file-picker-modal"),
  filePickerClose: $("#file-picker-close"),
  filePickerList: $("#file-picker-list"),
  inTitle: $("#in-title"),
  titleCharCount: $("#title-char-count"),
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
  stage: $("#stage"),
  pageTabs: $("#page-tabs"),
  pageAddModal: $("#page-add-modal"),
  pageAddClose: $("#page-add-close"),
  pageAddLabel: $("#page-add-label"),
  pageAddChooseFile: $("#page-add-choose-file"),
  pageAddStatus: $("#page-add-status"),
  protoFrame: $("#proto-frame"),
  overlay: $("#overlay"),
  pinLayer: $("#pin-layer"),
  pinPreview: $("#pin-preview"),
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
  voteGo: $("#vote-go"),
  voteNogo: $("#vote-nogo"),
  railToggleComments: $("#rail-toggle-comments"),
  railBodyComments: $("#rail-body-comments"),
  railToggleVote: $("#rail-toggle-vote"),
  railBodyVote: $("#rail-body-vote"),

  menuModal: $("#menu-modal"),
  modeInteract: $("#mode-interact"),
  modeComment: $("#mode-comment"),
  shareReview: $("#share-review"),
  shareReviewLabel: $("#share-review-label"),
  newReview: $("#new-review"),

  detailsPanel: $("#details-panel"),
  closeDetails: $("#close-details"),
  detailsEdit: $("#details-edit"),
  editRepo: $("#edit-repo"),
  editResolveBtn: $("#edit-resolve"),
  editResolveManualBtn: $("#edit-resolve-manual"),
  editResolveStatus: $("#edit-resolve-status"),
  editToken: $("#edit-token"),
  syncStatusLabel: $("#sync-status-label"),
  syncStatusIcon: $("#sync-status-icon"),
  syncStatusText: $("#sync-status-text"),
  editUrl: $("#edit-url"),
  editUrlWarning: $("#edit-url-warning"),
  editTitle: $("#edit-title"),
  editTzero: $("#edit-tzero"),
  editBriefChecklist: $("#edit-brief-checklist"),
  editAddBriefField: $("#edit-add-brief-field"),
  cancelEditDetails: $("#cancel-edit-details"),


  composer: $("#composer"),
  composerAvatar: $("#composer-avatar"),
  commentBody: $("#comment-body"),
  composerSend: $("#composer-send"),
  composerClose: $("#composer-close"),
  composerEmojiToggle: $("#composer-emoji-toggle"),

  clickCatcher: $("#click-catcher"),
  clickCatcherWorkspace: $("#click-catcher-workspace"),

  threadModal: $("#thread-modal"),
  closeThreadModal: $("#close-thread-modal"),
  threadModalAvatar: $("#thread-modal-avatar"),
  threadModalAuthor: $("#thread-modal-author"),
  threadModalMeta: $("#thread-modal-meta"),
  threadModalText: $("#thread-modal-text"),
  threadModalTags: $("#thread-modal-tags"),
  threadModalTagToggle: $("#thread-modal-tag-toggle"),
  threadModalReactions: $("#thread-modal-reactions"),
  reactionPickerModal: $("#reaction-picker-modal"),
  reactionPickerOptions: $("#reaction-picker-options"),
  emojiInsertModal: $("#emoji-insert-modal"),
  emojiInsertOptions: $("#emoji-insert-options"),
  threadModalEmojiToggle: $("#thread-modal-emoji-toggle"),
  threadModalReplies: $("#thread-modal-replies"),
  threadModalReplyForm: $("#thread-modal-reply-form"),
  threadModalReplyAvatar: $("#thread-modal-reply-avatar"),
  threadModalReplyInput: $("#thread-modal-reply-input"),
  threadModalReplySend: $("#thread-modal-reply-send"),
  threadModalResolve: $("#thread-modal-resolve"),
  threadModalMoreToggle: $("#thread-modal-more-toggle"),
  threadModalMoreMenu: $("#thread-modal-more-menu"),
  threadModalCopyLink: $("#thread-modal-copy-link"),
  threadModalMarkUnread: $("#thread-modal-mark-unread"),

  threadTagModal: $("#thread-tag-modal"),
  threadTagModalClose: $("#thread-tag-modal-close"),
  threadModalTagOptions: $("#thread-modal-tag-options"),
  threadModalTagInput: $("#thread-modal-tag-input"),
  threadModalTagAdd: $("#thread-modal-tag-add"),

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

/* ---------- feedback focus checklist (user-authored, 1–20 fields) ---------- */

const BRIEF_FIELDS_MIN = 1;
const BRIEF_FIELDS_MAX = 20;

// icons throughout the app (this file and index.html alike) are
// plain system symbols/emoji rather than custom vector art — sized
// via .icon's font-size, colored via currentColor same as before
const TRASH_ICON = "🗑️";

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

const ADD_FIELD_ICON = "+";

const updateAddButtonState = (container, addButton) => {
  const count = container.children.length;
  const atMax = count >= BRIEF_FIELDS_MAX;
  addButton.disabled = atMax;

  if (addButton.id === "add-brief-field") {
    addButton.innerHTML = atMax ? `Maximum ${BRIEF_FIELDS_MAX} reached` : `${ADD_FIELD_ICON} Add focus area`;
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
      if (container.children.length <= 1) return;
      btn.closest(".checklist-item").remove();
      updateAddButtonState(container, addButton);
    });
  });

  addButton.onclick = () => {
    if (container.children.length >= BRIEF_FIELDS_MAX) return;
    const row = briefFieldRow("");
    row.querySelector(".remove-field").addEventListener("click", () => {
      if (container.children.length <= 1) return;
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
  { id: "blocker", label: "Blocker", color: "#E30039" },
  { id: "a11y", label: "A11y", color: "#2F6FED" },
  { id: "ux", label: "UX", color: "#1FA463" },
  { id: "visual-design", label: "Visual design", color: "#8B5CF6" },
  { id: "business-review", label: "Business review", color: "#F2942B" },
  { id: "design-system", label: "Design system", color: "#E23FA0" },
  { id: "content", label: "Content", color: "#2BB3B3" },
  { id: "bug", label: "Bug", color: "#E5484D" },
];

const isBlocker = (c) => (c.tags || []).some((t) => t.id === "blocker");

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

/* ---------- reactions ----------
 * A fixed set of emoji, GitHub-issue-style, rather than a full emoji
 * keyboard — comment.reactions is {emoji: [deviceId, ...]}, keyed by
 * the same anonymous per-browser id the go/no-go vote uses, so a
 * reactor can toggle their own reaction off without a name attached.
 */

const REACTION_EMOJIS = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"];

const toggleReaction = (c, emoji) => {
  c.reactions = c.reactions || {};
  const reactors = c.reactions[emoji] || [];
  const idx = reactors.indexOf(deviceId);
  if (idx === -1) reactors.push(deviceId);
  else reactors.splice(idx, 1);
  if (reactors.length) c.reactions[emoji] = reactors;
  else delete c.reactions[emoji];
  touch(c);
  save();
  scheduleSync();
};

const closeReactionPicker = () => {
  el.reactionPickerModal.classList.add("is-hidden");
  hideCatcher();
};

const openReactionPicker = (anchorEl, c, onChange) => {
  el.reactionPickerOptions.innerHTML = "";
  REACTION_EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reaction-option";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      toggleReaction(c, emoji);
      closeReactionPicker();
      onChange();
    });
    el.reactionPickerOptions.appendChild(btn);
  });
  el.reactionPickerModal.classList.remove("is-hidden");
  positionBelow(anchorEl, el.reactionPickerModal);
  showCatcher(closeReactionPicker, "workspace");
};

const renderReactions = (container, c) => {
  c.reactions = c.reactions || {};
  container.innerHTML = "";

  Object.entries(c.reactions).forEach(([emoji, reactors]) => {
    if (!reactors.length) return;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `reaction-chip${reactors.includes(deviceId) ? " is-on" : ""}`;
    chip.textContent = `${emoji} ${reactors.length}`;
    chip.addEventListener("click", () => {
      toggleReaction(c, emoji);
      renderReactions(container, c);
    });
    container.appendChild(chip);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "reaction-add-btn";
  addBtn.setAttribute("aria-label", "Add reaction");
  addBtn.innerHTML = ADD_FIELD_ICON;
  addBtn.addEventListener("click", () => openReactionPicker(addBtn, c, () => renderReactions(container, c)));
  container.appendChild(addBtn);
};

/* ---------- emoji-insert picker ----------
 * Distinct from the reaction picker above: this one is opened from a
 * comment/reply's own 😊 button and inserts the chosen character into
 * that textarea at the cursor position — typing with emoji, not
 * reacting to a posted comment.
 */

const insertEmojiAtCursor = (textarea, emoji) => {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  textarea.value = textarea.value.slice(0, start) + emoji + textarea.value.slice(end);
  const caret = start + emoji.length;
  textarea.setSelectionRange(caret, caret);
  textarea.focus();
  // re-fires the input listeners already wired to each textarea (send
  // enable/disable, auto-grow) since setting .value directly doesn't
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

const closeEmojiInsertPicker = () => {
  el.emojiInsertModal.classList.add("is-hidden");
  hideCatcher();
};

const openEmojiInsertPicker = (anchorEl, textarea) => {
  el.emojiInsertOptions.innerHTML = "";
  REACTION_EMOJIS.forEach((emoji) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reaction-option";
    btn.textContent = emoji;
    btn.addEventListener("click", () => {
      insertEmojiAtCursor(textarea, emoji);
      closeEmojiInsertPicker();
    });
    el.emojiInsertOptions.appendChild(btn);
  });
  el.emojiInsertModal.classList.remove("is-hidden");
  positionBelow(anchorEl, el.emojiInsertModal);
  showCatcher(closeEmojiInsertPicker, "workspace");
};

const autoGrowTextarea = (textarea) => {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
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

// `fetch()` itself throws a bare TypeError ("Failed to fetch" in
// Chrome, "NetworkError when attempting to fetch resource." in
// Firefox) whenever the request never got a response at all — lost
// connection, DNS failure, a browser extension blocking it, CORS,
// GitHub unreachable. Browsers deliberately don't say which, for
// security reasons, so the best we can do is rule out "offline" and
// name the realistic remaining causes rather than parrot the raw
// message back at someone.
const isNetworkFetchError = (err) => err instanceof TypeError && /fetch|network/i.test(err.message);

const describeFetchError = (err, context = "GitHub") => {
  if (!isNetworkFetchError(err)) return err.message;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return `Couldn't reach ${context} — you appear to be offline. Check your connection and try again.`;
  }
  return (
    `Couldn't reach ${context} — the request never got a response. This is usually a dropped connection, ` +
    `a browser extension (ad blocker/privacy tool) blocking it, or ${context} being unreachable from this ` +
    "network. Check your connection and try again."
  );
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A dropped packet or a momentary DNS/Wi-Fi hiccup throws the exact
// same bare TypeError as a genuinely unreachable host, and is common
// enough that failing a whole lookup over one blip — right before
// telling someone to go "check your connection" — is worth ruling out
// first. One retry after a short pause; a second failure is treated
// as real, and describeFetchError() explains that one to the user.
const fetchWithRetry = async (url, options) => {
  try {
    return await fetch(url, options);
  } catch (err) {
    if (!isNetworkFetchError(err)) throw err;
    await sleep(800);
    return fetch(url, options);
  }
};

// GitHub-facing errors are near-meaningless on their own ("GitHub API
// 403") — say what actually happened and what to do about it.
const describeGithubError = (status, hasToken) => {
  if (status === 403) {
    return hasToken
      ? "GitHub blocked this (403) — your token likely doesn't have Contents access to this repository. Check the token's permissions."
      : "GitHub rate-limited this lookup (403) — unauthenticated requests are capped at 60/hour. Go back and add a token, then try again.";
  }
  if (status === 401) return "GitHub rejected the token (401) — check it was copied correctly and hasn't expired.";
  if (status >= 500) return `GitHub is having issues right now (${status}) — try again in a moment.`;
  return `GitHub API error (${status})`;
};

const ghContents = async (owner, repo, path = "", token = "") => {
  const res = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `token ${token}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(describeGithubError(res.status, !!token));
  return res.json();
};

const findEntryFile = async (owner, repo, token = "") => {
  const matchIn = (list, names) =>
    Array.isArray(list) ? list.find((it) => it.type === "file" && names.includes(it.name.toLowerCase())) : null;
  const dirNamed = (list, name) =>
    Array.isArray(list) ? list.find((it) => it.type === "dir" && it.name.toLowerCase() === name) : null;

  const root = await ghContents(owner, repo, "", token);
  if (!root) {
    throw new Error(
      token
        ? "Repository not found — check the URL, or that this token has access to it."
        : "Repository not found — check the URL. If it's private, add a token in the previous step.",
    );
  }

  let hit = matchIn(root, ["index.html"]);
  if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };

  for (const dirName of ["public", "dist", "build"]) {
    const dir = dirNamed(root, dirName);
    if (!dir) continue;
    const listing = await ghContents(owner, repo, dir.path, token);
    hit = matchIn(listing, ["index.html"]);
    if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };
  }

  hit = matchIn(root, ["app.tsx", "app.jsx"]);
  if (hit) return { kind: "source", path: hit.path, downloadUrl: hit.download_url };

  const src = dirNamed(root, "src");
  if (src) {
    const listing = await ghContents(owner, repo, src.path, token);
    hit = matchIn(listing, ["index.html"]);
    if (hit) return { kind: "html", path: hit.path, downloadUrl: hit.download_url };
    hit = matchIn(listing, ["app.tsx", "app.jsx"]);
    if (hit) return { kind: "source", path: hit.path, downloadUrl: hit.download_url };
  }

  return null;
};

// fetches an already-located file (entry = {kind, path, downloadUrl})
// and wraps it into the shape the workspace expects — shared by the
// naming-convention auto-detect below and the manual file picker,
// since both end up with the same {kind, path, downloadUrl} once
// they've found a candidate, just by different routes
const fetchResolvedFile = async (owner, repo, entry, token = "") => {
  // Read the file's own content back from the Contents API itself
  // (api.github.com), which already returns it inline as base64 for
  // anything under 1MB — the same response that gave us downloadUrl
  // in the first place. That avoids a second hop to a different
  // domain (raw.githubusercontent.com) for the actual bytes, which
  // some networks (a corporate VPN/proxy, in particular) block
  // outright even when api.github.com itself is reachable — the
  // file picker can list a repo's contents just fine on such a
  // network and still fail here, because listing never leaves
  // api.github.com but this used to.
  let text;
  let downloadUrl;
  try {
    const res = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}/contents/${entry.path}`, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: `token ${token}` } : {}) },
    });
    if (!res.ok) return { error: `${describeGithubError(res.status, !!token)} — could not fetch ${entry.path}` };
    const info = await res.json();
    downloadUrl = info.download_url;

    if (info.content) {
      text = b64DecodeUnicode(info.content);
    } else if (info.download_url) {
      // only reached for files over 1MB, where GitHub omits inline
      // content — a last resort that does cross to the other domain
      const fileRes = await fetchWithRetry(info.download_url);
      if (!fileRes.ok) return { error: `${describeGithubError(fileRes.status, !!token)} — could not fetch ${entry.path}` };
      text = await fileRes.text();
    } else {
      return { error: `GitHub returned no readable content for ${entry.path}.` };
    }
  } catch (err) {
    return { error: describeFetchError(err) };
  }

  if (entry.kind === "html") {
    const rawDir = downloadUrl.slice(0, downloadUrl.lastIndexOf("/") + 1);
    const html = /<base[\s>]/i.test(text)
      ? text
      : text.replace(/<head(\s[^>]*)?>/i, (m) => `${m}\n<base href="${rawDir}">`);
    return { kind: "html", path: entry.path, html };
  }

  return { kind: "source", path: entry.path, source: text };
};

const resolveEntryFromRepo = async (repoInput, token = "") => {
  const parsed = parseGithubRepo(repoInput);
  if (!parsed) return { error: "Not a valid GitHub repository URL" };

  let entry;
  try {
    entry = await findEntryFile(parsed.owner, parsed.repo, token);
  } catch (err) {
    return { error: describeFetchError(err) };
  }

  if (!entry) {
    return {
      error:
        "No entry file found by naming convention (index.html at the root, /public, /dist, or /build; App.tsx at the root or /src). Use \"Choose file\" to pick the right one yourself.",
    };
  }

  return fetchResolvedFile(parsed.owner, parsed.repo, entry, token);
};

/* ---------- manual file picker ----------
 * The fallback for when naming-convention auto-detect can't find a
 * build (a nonstandard layout) or found the wrong one. Lists every
 * file in the repo's default branch via the git trees API and lets
 * the user click the real one directly, rather than being stuck
 * renaming files to match a convention.
 */

const ICON_FOLDER = "📁";
const ICON_FILE_HTML = "🌐";
const ICON_FILE_CODE = "💻";
const ICON_FILE_PLAIN = "📄";

const iconForFile = (name) => {
  if (/\.html?$/i.test(name)) return ICON_FILE_HTML;
  if (/\.(tsx|jsx|ts|js|mjs|cjs)$/i.test(name)) return ICON_FILE_CODE;
  return ICON_FILE_PLAIN;
};

// the git trees API returns every blob/tree in the branch as one flat
// list of full paths (e.g. "prototype/build/main.html") — this turns
// that into an actual nested structure so the picker can be browsed
// folder by folder instead of dumped out as one long flat list
const buildFileTree = (entries) => {
  const root = { name: "", path: "", type: "dir", children: [] };
  const dirs = new Map([["", root]]);

  const ensureDir = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const cut = path.lastIndexOf("/");
    const parent = ensureDir(cut === -1 ? "" : path.slice(0, cut));
    const node = { name: path.slice(cut + 1), path, type: "dir", children: [] };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };

  entries.forEach((e) => {
    if (e.type === "tree") {
      ensureDir(e.path);
    } else if (e.type === "blob") {
      const cut = e.path.lastIndexOf("/");
      const parent = ensureDir(cut === -1 ? "" : e.path.slice(0, cut));
      parent.children.push({ name: e.path.slice(cut + 1), path: e.path, type: "file" });
    }
  });

  const sortNode = (node) => {
    node.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
    node.children.filter((c) => c.type === "dir").forEach(sortNode);
  };
  sortNode(root);

  return root;
};

const listRepoTree = async (owner, repo, token) => {
  const authHeaders = token ? { Authorization: `token ${token}` } : {};
  const repoRes = await fetchWithRetry(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { Accept: "application/vnd.github+json", ...authHeaders },
  });
  if (!repoRes.ok) throw new Error(describeGithubError(repoRes.status, !!token));
  const { default_branch } = await repoRes.json();

  const treeRes = await fetchWithRetry(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(default_branch)}?recursive=1`,
    { headers: { Accept: "application/vnd.github+json", ...authHeaders } },
  );
  if (!treeRes.ok) throw new Error(describeGithubError(treeRes.status, !!token));
  const tree = await treeRes.json();
  return buildFileTree(tree.tree || []);
};

// same {kind, path, html|source}/{error} shape as resolveEntryFromRepo,
// so both can be applied to state.review the same way
const resolveManualFile = async (owner, repo, path, token) => {
  const kind = /\.html?$/i.test(path) ? "html" : "source";
  return fetchResolvedFile(owner, repo, { kind, path }, token);
};

let filePickerOnPick = null;
let filePickerRoot = null;
// the path of dir nodes from the tree root down to the folder
// currently being viewed — empty means "at the root"
let filePickerCwd = [];

const closeFilePicker = () => {
  el.filePickerModal.classList.add("is-hidden");
  hideCatcher();
};

const renderFilePickerList = () => {
  const node = filePickerCwd[filePickerCwd.length - 1] || filePickerRoot;
  el.filePickerList.innerHTML = "";

  const addRow = (icon, label, onClick) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "file-picker-row";
    const iconSpan = document.createElement("span");
    iconSpan.className = "file-picker-icon";
    iconSpan.innerHTML = icon;
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    row.append(iconSpan, labelSpan);
    row.addEventListener("click", onClick);
    el.filePickerList.appendChild(row);
  };

  if (filePickerCwd.length) {
    addRow(ICON_FOLDER, "..", () => {
      filePickerCwd.pop();
      renderFilePickerList();
    });
  }

  if (!node.children.length) {
    const empty = document.createElement("p");
    empty.className = "micro";
    empty.textContent = "Empty folder.";
    el.filePickerList.appendChild(empty);
    return;
  }

  node.children.forEach((child) => {
    if (child.type === "dir") {
      addRow(ICON_FOLDER, child.name, () => {
        filePickerCwd.push(child);
        renderFilePickerList();
      });
    } else {
      addRow(iconForFile(child.name), child.name, () => filePickerOnPick?.(child.path));
    }
  });
};

// onPick(path) applies the chosen file to state.review; the wizard
// and the Details panel each pass their own, since the surrounding
// status UI differs, but both end up calling resolveManualFile
const openFilePicker = async (repoValue, onPick) => {
  const parsed = parseGithubRepo(repoValue);
  if (!parsed) return;

  filePickerOnPick = onPick;
  filePickerCwd = [];
  el.filePickerList.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "micro";
  loading.textContent = "Loading file list…";
  el.filePickerList.appendChild(loading);

  el.filePickerModal.classList.remove("is-hidden");
  showCatcher(closeFilePicker);

  try {
    filePickerRoot = await listRepoTree(parsed.owner, parsed.repo, githubToken);
    renderFilePickerList();
  } catch (err) {
    el.filePickerList.innerHTML = "";
    const errNode = document.createElement("p");
    errNode.className = "warning";
    errNode.textContent = describeFetchError(err);
    el.filePickerList.appendChild(errNode);
  }
};

el.filePickerClose.addEventListener("click", closeFilePicker);

/* ---------- discovering an existing review on this repo ----------
 * A teammate pasting the same repo URL has no way to know someone
 * already started a review on it — there's no shared link involved,
 * just the bare repo. So when a repo URL is entered, look for
 * slug folders under .tminus/ on the default branch (that's where a
 * review's synced snapshot lives) and, if any exist, offer to join
 * one instead of silently creating a duplicate review nobody else
 * will ever see. Anonymous/unauthenticated — works for public repos,
 * same as entry-file resolution above.
 */

const listReviewSlugs = async (owner, repo) => {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.tminus`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return [];
    const entries = await res.json();
    return entries.filter((e) => e.type === "dir").map((e) => e.name).slice(0, 10);
  } catch {
    return [];
  }
};

const fetchReviewSnapshotForSlug = async (owner, repo, slug) => {
  const path = `.tminus/${slug}/comments.json`;
  try {
    // HEAD resolves to the repo's default branch, so this never needs
    // to know or look up its name
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`);
    if (!res.ok) return null;
    const json = await res.json();
    return { slug, ...json };
  } catch {
    return null;
  }
};

const scanForExistingReviews = async (repoInput) => {
  const parsed = parseGithubRepo(repoInput);
  if (!parsed) return [];
  const slugs = await listReviewSlugs(parsed.owner, parsed.repo);
  const snapshots = await Promise.all(slugs.map((slug) => fetchReviewSnapshotForSlug(parsed.owner, parsed.repo, slug)));
  return snapshots.filter(Boolean);
};

/* ---------- writing comments back to the repo ----------
 * Optional and opt-in, configured only from the workspace's Details
 * panel (not the wizard). Without a token, everything stays in this
 * browser's localStorage only. With a token, comments and votes are
 * written as a single JSON snapshot file straight to the repo's
 * default branch — no side branch, no pull request, nothing waiting
 * on approval. The token itself is stored only in localStorage and
 * sent directly from this browser to api.github.com — there is no
 * T-Minus server to route it through or hide it behind. That's a real
 * tradeoff, stated here rather than hidden.
 */

const setGithubToken = (token) => {
  githubToken = token || "";
  try {
    if (githubToken) {
      sessionStorage.setItem(KEY_TOKEN, githubToken);
      sessionStorage.setItem(KEY_TOKEN_TOUCHED, String(Date.now()));
    } else {
      sessionStorage.removeItem(KEY_TOKEN);
      sessionStorage.removeItem(KEY_TOKEN_TOUCHED);
    }
  } catch {
    // sessionStorage unavailable — token still works for this page load
  }
};

// resets the idle clock on every authenticated call, so a tab that's
// actively syncing never loses its token mid-use, only one left idle
const touchGithubToken = () => {
  if (!githubToken) return;
  try {
    sessionStorage.setItem(KEY_TOKEN_TOUCHED, String(Date.now()));
  } catch {
    // sessionStorage unavailable — nothing to touch
  }
};

const b64EncodeUnicode = (str) =>
  btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(`0x${hex}`)));

const b64DecodeUnicode = (str) =>
  decodeURIComponent(
    atob(str.replace(/\n/g, ""))
      .split("")
      .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  );

const ghAuthFetch = async (path, token, options = {}) => {
  touchGithubToken();
  const res = await fetchWithRetry(`https://api.github.com/${path}`, {
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

const getFileSha = async (owner, repo, path, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/contents/${path}`, token);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const json = await res.json();
  return json.sha || null;
};

// writes straight to the repo's default branch — omitting `branch`
// lets the Contents API pick it, so this never needs to look it up
const putFile = async (owner, repo, path, content, message, sha, token) => {
  const res = await ghAuthFetch(`repos/${owner}/${repo}/contents/${path}`, token, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: b64EncodeUnicode(content), ...(sha ? { sha } : {}) }),
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

const SYNC_ICON_CHECK = "✓";
const SYNC_ICON_ALERT = "⚠";
const SYNC_ICON_SPIN = "↻";
const SYNC_ICON_IDLE = "○";

// full detail (the file path, the exact error) used to live in this
// text and read as noise for something that's supposed to be a quiet
// footer status — kept to a two/three-word label plus a state icon
const updateSyncUI = () => {
  if (!el.syncStatusLabel) return;
  el.syncStatusLabel.classList.remove("is-synced", "is-error");
  el.syncStatusIcon.classList.remove("is-spinning");

  if (syncStatus === "nocreds") {
    el.syncStatusIcon.innerHTML = SYNC_ICON_IDLE;
    el.syncStatusText.textContent = "Not shared";
  } else if (syncStatus === "pending" || syncStatus === "syncing") {
    el.syncStatusIcon.innerHTML = SYNC_ICON_SPIN;
    el.syncStatusIcon.classList.add("is-spinning");
    el.syncStatusText.textContent = "Syncing…";
  } else if (syncStatus === "synced") {
    el.syncStatusIcon.innerHTML = SYNC_ICON_CHECK;
    el.syncStatusText.textContent = "Synced";
    el.syncStatusLabel.classList.add("is-synced");
  } else if (syncStatus === "error") {
    el.syncStatusIcon.innerHTML = SYNC_ICON_ALERT;
    el.syncStatusText.textContent = "Sync failed";
    el.syncStatusLabel.classList.add("is-error");
  } else {
    el.syncStatusIcon.innerHTML = SYNC_ICON_IDLE;
    el.syncStatusText.textContent = "Not synced";
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
    const path = `.tminus/${slug}/comments.json`;

    const payload = JSON.stringify(
      {
        review: state.review.title,
        updatedAt: new Date().toISOString(),
        // enough of the review config for a teammate who finds this
        // branch to join it, without carrying the large resolved
        // HTML/source blobs — those get re-resolved live on join
        reviewConfig: {
          title: state.review.title,
          tzero: state.review.tzero,
          brief: state.review.brief,
          briefAreas: state.review.briefAreas,
          url: state.review.url,
          // metadata only, same reasoning as the comment above — a
          // page's html/source gets re-resolved live from its path,
          // never carried through the synced snapshot itself
          pages: state.review.pages.map((p) => ({ id: p.id, label: p.label, kind: p.kind, path: p.path, url: p.url })),
        },
        comments: state.comments,
        votes: state.votes,
      },
      null,
      2,
    );

    const existingSha = await getFileSha(parsed.owner, parsed.repo, path, githubToken);
    await putFile(
      parsed.owner,
      parsed.repo,
      path,
      payload,
      `T-Minus: update comments (${state.comments.length} total)`,
      existingSha,
      githubToken,
    );

    syncStatus = "synced";
    syncMessage = path;
  } catch (err) {
    syncStatus = "error";
    syncMessage = describeFetchError(err);
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

/* ---------- pulling other reviewers' comments back in ----------
 * The write side (above) pushes this browser's comments/votes to
 * .tminus/<slug>/comments.json on the repo's default branch. Without a
 * read side, that file was a write-only backup nobody ever saw — this
 * fetches it back and merges it into local state, so multiple people
 * commenting on the same repo actually see each other. Reading is
 * anonymous (works for any public repo) when there's no token, and
 * goes through the authenticated Contents API — needed for private
 * repos — when there is one.
 */

const fetchRemoteSnapshot = async (owner, repo, slug) => {
  const path = `.tminus/${slug}/comments.json`;
  try {
    if (githubToken) {
      const res = await ghAuthFetch(`repos/${owner}/${repo}/contents/${path}`, githubToken);
      if (!res.ok) return null;
      const json = await res.json();
      return JSON.parse(b64DecodeUnicode(json.content));
    }
    // HEAD resolves to the repo's default branch
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

// merges one comment thread from each side field-by-field, rather than
// picking one side wholesale — a naive last-write-wins would silently
// drop a reply or tag the other side added concurrently
const mergeComment = (local, remote) => {
  const tagMap = new Map();
  [...(remote.tags || []), ...(local.tags || [])].forEach((t) => tagMap.set(t.id, t));

  const replyMap = new Map();
  [...(remote.replies || []), ...(local.replies || [])].forEach((r) => {
    const key = r.id || `${r.author}:${r.body}:${r.createdAt || ""}`;
    replyMap.set(key, r);
  });
  const replies = [...replyMap.values()].sort(
    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
  );

  // same union approach as tags above: each emoji's reactor list is
  // the combined set from both sides, deduped by device id
  const reactions = {};
  new Set([...Object.keys(remote.reactions || {}), ...Object.keys(local.reactions || {})]).forEach((emoji) => {
    const ids = [...new Set([...(remote.reactions?.[emoji] || []), ...(local.reactions?.[emoji] || [])])];
    if (ids.length) reactions[emoji] = ids;
  });

  const newer =
    new Date(local.updatedAt || local.createdAt) >= new Date(remote.updatedAt || remote.createdAt) ? local : remote;

  return {
    ...remote,
    ...local,
    resolved: newer.resolved,
    tags: [...tagMap.values()],
    reactions,
    replies,
    updatedAt: newer.updatedAt || newer.createdAt,
  };
};

const mergeComments = (localComments, remoteComments) => {
  const byId = new Map();
  remoteComments.forEach((c) => byId.set(c.id, c));
  localComments.forEach((c) => {
    const existing = byId.get(c.id);
    byId.set(c.id, existing ? mergeComment(c, existing) : c);
  });
  return [...byId.values()];
};

const pullRemoteComments = async () => {
  if (!state.created || !state.review.repo || !state.review.repoConnected) return;
  const parsed = parseGithubRepo(state.review.repo);
  if (!parsed) return;

  const slug = state.review.slug || slugify(state.review.title || "review");
  const snapshot = await fetchRemoteSnapshot(parsed.owner, parsed.repo, slug);
  if (!snapshot) return;

  state.comments = mergeComments(state.comments, snapshot.comments || []);
  state.votes = { ...(snapshot.votes || {}), ...state.votes };

  // a page someone else added shows up here as metadata only — fetch
  // its content and adopt it, but never touch a page this browser
  // already has (its own resolution is at least as fresh)
  const knownIds = new Set(state.review.pages.map((p) => p.id));
  const newPageMetas = (snapshot.reviewConfig?.pages || []).filter((p) => !knownIds.has(p.id));
  if (newPageMetas.length) {
    const newPages = await Promise.all(newPageMetas.map((p) => fetchPageContent(parsed.owner, parsed.repo, p, githubToken)));
    state.review.pages.push(...newPages);
    renderPageTabs();
  }

  save();
  renderWorkspace();
  if (openThreadId) renderThreadModal();
};

/* ---------- wizard: step 2, repo access ---------- */

el.inRepo.addEventListener("input", () => {
  state.review.repoConnected = false;
  autoResolveAttemptedFor = "";
});

/* ---------- existing-review modal ---------- */

let lastScannedRepo = "";

const closeExistingReviewModal = () => {
  el.existingReviewModal.classList.add("is-hidden");
  hideCatcher();
};

const renderExistingReviewList = (found) => {
  el.existingReviewList.innerHTML = "";
  found.forEach((snap) => {
    const row = document.createElement("div");
    row.className = "existing-review-row";

    const info = document.createElement("div");
    const title = document.createElement("p");
    title.className = "existing-review-title";
    title.textContent = snap.reviewConfig?.title || snap.review || "Untitled review";
    const meta = document.createElement("p");
    meta.className = "existing-review-meta";
    const count = (snap.comments || []).length;
    meta.textContent = `${count} comment${count === 1 ? "" : "s"} · updated ${relativeTime(snap.updatedAt)}`;
    info.append(title, meta);

    const joinBtn = document.createElement("button");
    joinBtn.type = "button";
    joinBtn.className = "btn btn-solid";
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => joinExistingReview(snap));

    row.append(info, joinBtn);
    el.existingReviewList.appendChild(row);
  });
};

const openExistingReviewModal = (found) => {
  renderExistingReviewList(found);
  el.existingReviewModal.classList.remove("is-hidden");
  showCatcher(closeExistingReviewModal);
};

const joinExistingReview = async (snap) => {
  const repo = el.inRepo.value.trim();
  const cfg = snap.reviewConfig || {};

  state.review.repo = repo;
  state.review.repoConnected = true;
  state.review.slug = snap.slug;
  state.review.title = cfg.title || snap.review || "Review";
  state.review.tzero = cfg.tzero || defaultTZero();
  state.review.brief = cfg.brief || "";
  state.review.briefAreas = cfg.briefAreas || [];
  state.review.url = cfg.url || "";
  state.comments = snap.comments || [];
  state.votes = snap.votes || {};

  closeExistingReviewModal();

  if (state.review.url) {
    state.review.resolvedKind = null;
    state.review.resolvedPath = "";
    state.review.resolvedHtml = "";
    state.review.resolvedSource = "";
  } else {
    applyResolveResult(await resolveEntryFromRepo(repo, githubToken));
  }

  state.created = true;
  save();
  openWorkspace();

  // page 1 is already resolved above (same as any single-page review);
  // any further pages in the synced snapshot are metadata only, fetched
  // and appended after the workspace is already open and usable
  if (cfg.pages?.length > 1) {
    const parsed = parseGithubRepo(repo);
    const extra = await Promise.all(
      cfg.pages.slice(1).map((p) => fetchPageContent(parsed.owner, parsed.repo, p, githubToken)),
    );
    state.review.pages.push(...extra);
    save();
    renderPageTabs();
  }
};

el.existingReviewClose.addEventListener("click", closeExistingReviewModal);
el.existingReviewStartNew.addEventListener("click", closeExistingReviewModal);

el.inRepo.addEventListener("blur", async () => {
  const value = el.inRepo.value.trim();
  if (!value || value === lastScannedRepo) return;
  lastScannedRepo = value;

  const found = await scanForExistingReviews(value);
  if (found.length && el.inRepo.value.trim() === value) {
    openExistingReviewModal(found);
  }
});

/* ---------- wizard: step 4, review name ---------- */

const updateTitleCharCount = () => {
  el.titleCharCount.textContent = `${el.inTitle.value.length}/100 characters`;
};

el.inTitle.addEventListener("input", updateTitleCharCount);

/* ---------- wizard: step 3, resolve entry file ---------- */

// shared by auto-detect and the manual picker — both produce the same
// {kind, path, html|source} / {error} shape, this is just what happens
// to state.review once one of them has an answer
const applyResolveResult = (result) => {
  if (result.error) {
    state.review.resolvedKind = null;
    state.review.resolvedPath = "";
    state.review.resolvedHtml = "";
    state.review.resolvedSource = "";
  } else {
    state.review.resolvedKind = result.kind;
    state.review.resolvedPath = result.path;
    state.review.resolvedHtml = result.kind === "html" ? result.html : "";
    state.review.resolvedSource = result.kind === "source" ? result.source : "";
  }
  save();
  syncPageOneFromResolved();
};

const renderResolveStatus = () => {
  el.btnResolve.textContent = state.review.resolvedKind ? "Choose a different file" : "Choose file";

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

  const result = await resolveEntryFromRepo(repoValue, githubToken);
  applyResolveResult(result);

  if (result.error) {
    el.resolveStatus.textContent = "Not resolved";
    el.resolveNote.textContent = result.error;
    el.resolveNote.classList.remove("is-hidden");
  } else {
    renderResolveStatus();
  }
  el.btnResolve.disabled = false;
};

// runs automatically the first time step 3 is shown for a given repo,
// so reaching this step no longer requires clicking anything — the
// button only comes into play as the manual fallback below
let autoResolveAttemptedFor = "";

const autoResolveIfNeeded = () => {
  const repo = state.review.repo || el.inRepo.value.trim();
  if (!repo || !parseGithubRepo(repo) || state.review.resolvedKind || autoResolveAttemptedFor === repo) return;
  autoResolveAttemptedFor = repo;
  runResolve(repo);
};

el.btnResolve.addEventListener("click", () => {
  const repo = state.review.repo || el.inRepo.value.trim();
  if (!repo) {
    el.resolveStatus.textContent = "Not resolved";
    el.resolveNote.textContent = "Connect a repository in the previous step first.";
    el.resolveNote.classList.remove("is-hidden");
    return;
  }
  openFilePicker(repo, async (path) => {
    closeFilePicker();
    const parsed = parseGithubRepo(repo);
    el.resolveStatus.textContent = "Loading…";
    const result = await resolveManualFile(parsed.owner, parsed.repo, path, githubToken);
    applyResolveResult(result);
    if (result.error) {
      el.resolveStatus.textContent = "Not resolved";
      el.resolveNote.textContent = result.error;
      el.resolveNote.classList.remove("is-hidden");
    } else {
      renderResolveStatus();
    }
  });
});

/* ---------- wizard flow ---------- */

const goToStep = (n) => {
  step = n;
  renderStep();
};

const stepValue = () =>
  ({
    1: el.inCreatorName.value.trim() ? "ok" : "",
    2: el.inRepo.value.trim() && (el.inToken.value.trim() || githubToken) ? "ok" : "",
    3: state.review.resolvedKind ? "ok" : "",
    4: el.inTitle.value.trim(),
    5: el.inTzero.value.trim(),
    6: getBriefFieldValues(el.briefChecklist).length ? "ok" : "",
    7: "ok",
  })[step];

const CHECK_ICON = "✓";

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
  // a floor, not just step/total — at step 1 that's a ~14% sliver,
  // thin enough to read as "hasn't started" next to the empty track
  // behind it, when step 1 is already underway, not step 0
  el.progress.style.width = `${Math.max(20, (step / STEPS.length) * 100)}%`;
  el.error.textContent = "";
  closeTokenInfo();
  closeExistingReviewModal();

  el.steps.forEach((node) => node.classList.toggle("is-active", Number(node.dataset.step) === step));
  el.btnBack.classList.toggle("is-hidden", step === 1);
  el.btnNext.textContent = step === STEPS.length ? "Open Review" : "Continue";

  if (step === 3) {
    renderResolveStatus();
    autoResolveIfNeeded();
  }
  if (step === STEPS.length) renderSummary();
};

const commitStep = () => {
  if (step === 1) {
    state.creator.name = el.inCreatorName.value.trim();
    state.creator.email = el.inCreatorEmail.value.trim();
  }
  if (step === 2) {
    state.review.repo = el.inRepo.value.trim();
    const token = el.inToken.value.trim();
    if (token) setGithubToken(token);
  }
  if (step === 4) state.review.title = el.inTitle.value.trim();
  if (step === 5) state.review.tzero = new Date(el.inTzero.value).toISOString();
  if (step === 6) {
    state.review.briefAreas = getBriefFieldValues(el.briefChecklist);
    state.review.brief = formatBrief(state.review.briefAreas);
  }
  save();
};

// Pressing Enter in any text field submits the enclosing <form>
// natively; without this, that submit has no handler and the browser
// just reloads the page, silently discarding whatever was typed.
document.getElementById("wizard-form").addEventListener("submit", (e) => {
  e.preventDefault();
  el.btnNext.click();
});

el.btnNext.addEventListener("click", () => {
  if (step === 2 && el.inRepo.value.trim()) state.review.repoConnected = true;

  if (!stepValue()) {
    el.error.textContent =
      step === 1
        ? "Name is required"
        : step === 2
          ? el.inRepo.value.trim()
            ? "A GitHub token is required so your comments can be seen by others"
            : "Enter a repository to continue"
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

const visible = () => state.comments.filter((c) => state.showResolved || !c.resolved);

/* ---------- token info popover ---------- */

const closeTokenInfo = () => {
  el.tokenInfoModal.classList.add("is-hidden");
  hideCatcher();
};

el.tokenInfoToggle.addEventListener("click", () => {
  const opening = el.tokenInfoModal.classList.contains("is-hidden");
  if (opening) {
    el.tokenInfoModal.classList.remove("is-hidden");
    positionBelow(el.tokenInfoToggle, el.tokenInfoModal);
    showCatcher(closeTokenInfo);
  } else {
    closeTokenInfo();
  }
});

el.tokenInfoClose.addEventListener("click", closeTokenInfo);

const closeComposer = () => {
  anchor = null;
  el.composer.classList.add("is-hidden");
  el.commentBody.value = "";
  el.commentBody.style.height = "";
  el.composerSend.disabled = true;
};

/* ---------- pin hover preview + drag-to-reposition ----------
 * Pins show a styled preview bubble on hover (arrow cursor — this is
 * "opening", not dragging), and can be picked up and moved: mousedown
 * starts tracking, and only once the pointer has actually traveled
 * past a small threshold does it commit to a drag (cursor switches to
 * the closed-hand "grabbing" look). Anything under that threshold is
 * treated as a plain click that opens the comment.
 */

const PIN_DRAG_THRESHOLD = 4;
let pinDrag = null;

// Two comments anchored at (near enough to) the same point render as
// perfectly overlapping pins — only the topmost one is visible, so a
// second comment from the same spot (very common: several notes about
// one small element) silently looks like it never appeared. Nudge a
// new pin's position away from anything already sitting on top of it.
const PIN_COLLISION_EPS = 0.015;
const PIN_COLLISION_STEP = 0.02;

const dedupeAnchor = (x, y) => {
  let ax = x;
  let ay = y;
  // only comments on the same page can visually overlap — a pin on
  // another page sharing this x/y is no coincidence worth nudging
  const onThisPage = state.comments.filter((c) => commentPageId(c) === state.review.activePageId);
  for (let i = 0; i < 25; i += 1) {
    const collides = onThisPage.some((c) => Math.abs(c.x - ax) < PIN_COLLISION_EPS && Math.abs(c.y - ay) < PIN_COLLISION_EPS);
    if (!collides) break;
    ax = Math.min(0.97, x + (i + 1) * PIN_COLLISION_STEP);
    ay = Math.min(0.97, y + (i + 1) * PIN_COLLISION_STEP);
  }
  return { x: ax, y: ay };
};

const showPinPreview = (dot, comment) => {
  el.pinPreview.textContent = comment.body;
  el.pinPreview.style.left = dot.style.left;
  el.pinPreview.style.top = dot.style.top;
  el.pinPreview.classList.remove("is-hidden");
};

const hidePinPreview = () => el.pinPreview.classList.add("is-hidden");

const onPinDragMove = (e) => {
  if (!pinDrag) return;
  const dx = e.clientX - pinDrag.startX;
  const dy = e.clientY - pinDrag.startY;

  if (!pinDrag.moved && Math.hypot(dx, dy) > PIN_DRAG_THRESHOLD) {
    pinDrag.moved = true;
    document.body.classList.add("is-dragging-pin");
  }
  if (!pinDrag.moved) return;

  const { rect } = pinDrag;
  const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  pinDrag.dot.style.left = `${x * 100}%`;
  pinDrag.dot.style.top = `${y * 100}%`;
  pinDrag.x = x;
  pinDrag.y = y;
};

const onPinDragEnd = () => {
  if (!pinDrag) return;
  document.removeEventListener("mousemove", onPinDragMove);
  document.removeEventListener("mouseup", onPinDragEnd);
  document.body.classList.remove("is-dragging-pin");
  el.overlay.classList.remove("is-tracking-pin");

  const { comment, moved, x, y } = pinDrag;
  pinDrag = null;

  if (!moved) {
    openThreadModal(comment.id);
    return;
  }

  comment.x = x;
  comment.y = y;
  save();
  scheduleSync();
  renderPins();
};

const startPinDrag = (e, dot, comment) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  hidePinPreview();
  el.overlay.classList.add("is-tracking-pin");
  pinDrag = {
    dot,
    comment,
    rect: el.stage.getBoundingClientRect(),
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  };
  document.addEventListener("mousemove", onPinDragMove);
  document.addEventListener("mouseup", onPinDragEnd);
};

const renderPins = () => {
  el.pinLayer.innerHTML = "";
  visible()
    .filter((c) => commentPageId(c) === state.review.activePageId)
    .forEach((c) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = `pin-dot${isBlocker(c) ? " is-blocker" : ""}`;
    dot.style.setProperty("--pin-color", authorColor(c.author));
    dot.style.left = `${c.x * 100}%`;
    dot.style.top = `${c.y * 100}%`;
    dot.textContent = c.author.charAt(0).toUpperCase();
    dot.addEventListener("mouseenter", () => showPinPreview(dot, c));
    dot.addEventListener("mouseleave", hidePinPreview);
    dot.addEventListener("mousedown", (e) => startPinDrag(e, dot, c));
    el.pinLayer.appendChild(dot);
  });
};

/* ---------- "mark as unread" ----------
 * Purely local to this browser and this review — it's a reading aid
 * for whoever's viewing, not something that should broadcast to
 * every other reviewer, so it never touches state.comments or the
 * synced snapshot, just its own localStorage entry per review.
 */

const unreadStorageKey = () => `tminus.unread.${state.review.slug || "review"}`;

const readUnreadIds = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(unreadStorageKey()) || "[]"));
  } catch {
    return new Set();
  }
};

const writeUnreadIds = (ids) => localStorage.setItem(unreadStorageKey(), JSON.stringify([...ids]));

const isCommentUnread = (id) => readUnreadIds().has(id);

const markCommentUnread = (id) => {
  const ids = readUnreadIds();
  ids.add(id);
  writeUnreadIds(ids);
  renderThreads();
};

const markCommentRead = (id) => {
  const ids = readUnreadIds();
  if (!ids.has(id)) return;
  ids.delete(id);
  writeUnreadIds(ids);
  renderThreads();
};

const renderThreads = () => {
  el.threads.innerHTML = "";
  const list = visible();
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
    article.classList.toggle("is-unread", isCommentUnread(c.id));

    const avatar = node.querySelector(".avatar");
    avatar.style.setProperty("--avatar-color", authorColor(c.author));
    avatar.textContent = c.author.charAt(0).toUpperCase();

    node.querySelector(".thread-author").textContent = c.author;
    // only worth naming which page a comment lives on once there's
    // more than one — a single-page review has nothing to disambiguate
    const pageLabel =
      state.review.pages.length > 1
        ? state.review.pages.find((p) => p.id === commentPageId(c))?.label
        : null;
    const metaBits = [c.resolved ? "resolved" : null, pageLabel].filter(Boolean);
    node.querySelector(".thread-meta").textContent = [relativeTime(c.createdAt), ...metaBits].join(" · ");
    node.querySelector(".thread-body").textContent = c.body;
    renderTagList(node.querySelector(".thread-tags"), c.tags);

    // clicking a comment left on a different page switches the canvas
    // to that page first, so the thread modal opens somewhere its pin
    // actually makes sense on
    article.addEventListener("click", () => {
      const pageId = commentPageId(c);
      if (pageId !== state.review.activePageId) setActivePage(pageId);
      openThreadModal(c.id);
    });

    el.threads.appendChild(node);
  });
};

/* ---------- shared tag child-modal positioning ----------
   Stacks a small tag-picker panel directly below whichever comment
   modal (composer or thread-modal) it belongs to, so the parent modal
   itself never has to show the full tag library at once. */

// call this AFTER unhiding targetEl — its height reads as 0 while
// display:none, which defeats the clamp below
const positionBelow = (anchorEl, targetEl) => {
  const rect = anchorEl.getBoundingClientRect();
  const maxTop = window.innerHeight - targetEl.offsetHeight - 16;
  const top = Math.max(16, Math.min(rect.bottom + 8, maxTop));
  targetEl.style.top = `${top}px`;
  targetEl.style.left = `${rect.left}px`;
};

// the composer's top-right corner lands on the exact canvas point that
// was clicked (call after el.composer is unhidden, so its size is real)
const positionComposerAt = (clientX, clientY) => {
  const width = el.composer.offsetWidth;
  const height = el.composer.offsetHeight;
  const right = Math.max(16, Math.min(window.innerWidth - clientX, window.innerWidth - width - 16));
  const top = Math.max(16, Math.min(clientY, window.innerHeight - height - 16));
  el.composer.style.right = `${right}px`;
  el.composer.style.top = `${top}px`;
};

/* ---------- click-catcher ----------
 * A transparent full-page backdrop that closes whichever popover
 * (menu, tag picker) is open when clicked. A plain document click
 * listener can't reliably do this: a click landing inside the
 * prototype iframe happens in a separate document and never bubbles
 * up to ours, so the backdrop intercepts it before it reaches the
 * iframe at all.
 *
 * There are two catcher elements, not one: #screen-workspace is a
 * position:fixed stacking-context root, so a catcher living outside
 * it (needed for onboarding's own popovers) always paints above the
 * entire workspace subtree, no matter what z-index a popover inside
 * the workspace claims. #click-catcher-workspace lives inside
 * screen-workspace instead, sharing its stacking context, so
 * workspace popovers (menu, composer/thread tag modals) can outrank
 * it. Only ever show the one matching the popover's screen.
 */

let catcherDismiss = null;
let activeCatcherEl = null;

const showCatcher = (onDismiss, scope = "top") => {
  catcherDismiss = onDismiss;
  activeCatcherEl = scope === "workspace" ? el.clickCatcherWorkspace : el.clickCatcher;
  activeCatcherEl.classList.remove("is-hidden");
};

const hideCatcher = () => {
  el.clickCatcher.classList.add("is-hidden");
  el.clickCatcherWorkspace.classList.add("is-hidden");
  catcherDismiss = null;
  activeCatcherEl = null;
};

const onCatcherClick = () => {
  const dismiss = catcherDismiss;
  hideCatcher();
  dismiss?.();
};

el.clickCatcher.addEventListener("click", onCatcherClick);
el.clickCatcherWorkspace.addEventListener("click", onCatcherClick);

/* ---------- thread modal — each comment opens as its own modal
   rather than expanding inline in the sidebar ---------- */

const findComment = (id) => state.comments.find((c) => c.id === id);

// bumped on every mutation so merges with a synced remote copy can tell
// which side's version of a comment (resolved state, etc.) is newer
const touch = (c) => {
  c.updatedAt = new Date().toISOString();
  return c;
};

const closeThreadTagModal = () => {
  el.threadTagModal.classList.add("is-hidden");
  hideCatcher();
};

const closeThreadModal = () => {
  openThreadId = null;
  el.threadModal.classList.add("is-hidden");
  closeThreadTagModal();
  closeThreadModalMoreMenu();
};

const renderThreadModal = () => {
  const c = findComment(openThreadId);
  if (!c) {
    closeThreadModal();
    return;
  }
  c.tags = c.tags || [];

  el.threadModalAvatar.style.setProperty("--avatar-color", authorColor(c.author));
  el.threadModalAvatar.textContent = c.author.charAt(0).toUpperCase();
  el.threadModalAuthor.textContent = c.author;
  el.threadModalMeta.textContent = c.resolved
    ? `${relativeTime(c.createdAt)} · resolved`
    : relativeTime(c.createdAt);
  el.threadModalText.textContent = c.body;

  renderReactions(el.threadModalReactions, c);

  renderTagList(el.threadModalTags, c.tags, {
    removable: true,
    onRemove: (t) => {
      c.tags = c.tags.filter((existing) => existing.id !== t.id);
      touch(c);
      save();
      scheduleSync();
      renderThreadModal();
      renderThreads();
    },
  });
  renderTagOptions(el.threadModalTagOptions, c.tags, (t) => {
    const idx = c.tags.findIndex((existing) => existing.id === t.id);
    if (idx === -1) c.tags.push(t);
    else c.tags.splice(idx, 1);
    touch(c);
    save();
    scheduleSync();
    renderThreadModal();
    renderThreads();
  });

  el.threadModalReplies.innerHTML = "";
  c.replies.forEach((r) => {
    const p = document.createElement("p");
    p.className = "reply";
    p.textContent = `${r.author}: ${r.body}`;
    el.threadModalReplies.appendChild(p);
  });

  el.threadModalResolve.classList.toggle("is-resolved", !!c.resolved);
  el.threadModalResolve.setAttribute("aria-label", c.resolved ? "Reopen" : "Resolve");

  el.threadModalReplyAvatar.style.setProperty("--avatar-color", authorColor(state.creator.name || "T"));
  el.threadModalReplyAvatar.textContent = (state.creator.name || "T").charAt(0).toUpperCase();
};

const openThreadModal = (id) => {
  openThreadId = id;
  closeThreadTagModal();
  markCommentRead(id);
  renderThreadModal();
  el.threadModal.classList.remove("is-hidden");
};

el.closeThreadModal.addEventListener("click", closeThreadModal);

el.threadModalTagToggle.addEventListener("click", () => {
  const opening = el.threadTagModal.classList.contains("is-hidden");
  if (opening) {
    el.threadTagModal.classList.remove("is-hidden");
    positionBelow(el.threadModal, el.threadTagModal);
    showCatcher(closeThreadTagModal, "workspace");
  } else {
    closeThreadTagModal();
  }
});

el.threadTagModalClose.addEventListener("click", closeThreadTagModal);

wireCustomTagAdd(el.threadModalTagInput, el.threadModalTagAdd, (t) => {
  const c = findComment(openThreadId);
  if (!c) return;
  c.tags.push(t);
  touch(c);
  save();
  scheduleSync();
  renderThreadModal();
  renderThreads();
});

el.threadModalReplyInput.addEventListener("input", () => {
  el.threadModalReplySend.disabled = !el.threadModalReplyInput.value.trim();
  autoGrowTextarea(el.threadModalReplyInput);
});

el.threadModalEmojiToggle.addEventListener("click", () => {
  openEmojiInsertPicker(el.threadModalEmojiToggle, el.threadModalReplyInput);
});

el.threadModalReplyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const c = findComment(openThreadId);
  const body = el.threadModalReplyInput.value.trim();
  if (!c || !body || !state.creator.name) return;
  c.replies.push({ id: crypto.randomUUID(), author: state.creator.name, body, createdAt: new Date().toISOString() });
  touch(c);
  el.threadModalReplyInput.value = "";
  el.threadModalReplyInput.style.height = "";
  el.threadModalReplySend.disabled = true;
  save();
  scheduleSync();
  renderThreadModal();
  renderThreads();
});

el.threadModalResolve.addEventListener("click", () => {
  const c = findComment(openThreadId);
  if (!c) return;
  c.resolved = !c.resolved;
  touch(c);
  save();
  scheduleSync();
  renderThreadModal();
  renderThreads();
});

/* ---------- more-actions menu (⋯): copy link, mark as unread ---------- */

const closeThreadModalMoreMenu = () => {
  el.threadModalMoreMenu.classList.add("is-hidden");
};

el.threadModalMoreToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = el.threadModalMoreMenu.classList.contains("is-hidden");
  closeThreadModalMoreMenu();
  if (opening) {
    el.threadModalMoreMenu.classList.remove("is-hidden");
    positionBelow(el.threadModalMoreToggle, el.threadModalMoreMenu);
    showCatcher(closeThreadModalMoreMenu, "workspace");
  } else {
    hideCatcher();
  }
});

el.threadModalCopyLink.addEventListener("click", async () => {
  closeThreadModalMoreMenu();
  hideCatcher();
  if (!openThreadId) return;
  const url = `${location.origin}${location.pathname}#comment-${openThreadId}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // clipboard access denied — nothing else to fall back to here
  }
});

el.threadModalMarkUnread.addEventListener("click", () => {
  closeThreadModalMoreMenu();
  hideCatcher();
  if (openThreadId) markCommentUnread(openThreadId);
  closeThreadModal();
});

const renderWorkspace = () => {
  el.reviewTitle.textContent = state.review.title;
  el.countdown.textContent = countdown(state.review.tzero);

  // the tally only shows up once this device has voted — cast a vote
  // to see where things stand, rather than the count sitting there
  // (previously in a separate Open/Blockers/Go-no-go readout) for
  // anyone to read off without participating
  const myVote = state.votes[deviceId] || "";
  const voteValues = Object.values(state.votes);
  const goCount = voteValues.filter((v) => v === "go").length;
  const nogoCount = voteValues.filter((v) => v === "nogo").length;

  el.voteGo.textContent = myVote ? `Go · ${goCount}` : "Go";
  el.voteGo.classList.toggle("is-on", myVote === "go");
  el.voteGo.setAttribute("aria-pressed", String(myVote === "go"));

  el.voteNogo.textContent = myVote ? `No-go · ${nogoCount}` : "No-go";
  el.voteNogo.classList.toggle("is-on", myVote === "nogo");
  el.voteNogo.setAttribute("aria-pressed", String(myVote === "nogo"));

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

/* ---------- stage scaling ----------
 * The stage is a fixed-size artboard (matches .stage in styles.css)
 * that's scaled as a whole to fit whatever room the canvas actually
 * has. Scaling never reflows the page inside it — only the outer
 * canvas' width/height changes reflow a responsive prototype — so
 * this is what keeps a pin's fractional x/y anchored to the same
 * visual spot on the prototype regardless of window size, sidebar
 * width, etc. Recomputed on every canvas resize via ResizeObserver.
 */

const STAGE_WIDTH = 1440;
const STAGE_HEIGHT = 900;

const fitStage = () => {
  const canvasRect = el.canvas.getBoundingClientRect();
  if (!canvasRect.width || !canvasRect.height) return;
  const scale = Math.min(canvasRect.width / STAGE_WIDTH, canvasRect.height / STAGE_HEIGHT);
  const left = (canvasRect.width - STAGE_WIDTH * scale) / 2;
  const top = (canvasRect.height - STAGE_HEIGHT * scale) / 2;
  el.stage.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
};

new ResizeObserver(fitStage).observe(el.canvas);

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

/* ---------- multi-page support ----------
 * Each page is a self-contained resolved surface — {id, label, kind,
 * path, html, source, url}, the same shape the wizard's single-file
 * flow already produces via the flat state.review.resolved-/url
 * fields. The first time the workspace opens, ensurePages() folds
 * those flat fields into pages[0] so existing reviews (and the
 * wizard itself) keep working unchanged; the flat fields stay in
 * place after that only as what Details-panel re-resolution writes
 * to (kept in sync onto pages[0] specifically — Details edits the
 * original page, additional pages are managed from the page tabs).
 *
 * Comments carry a pageId. The sidebar lists every comment regardless
 * of page (commentPageId() also covers comments from before this
 * feature, which have no pageId at all); the canvas only ever renders
 * pins whose page matches the active tab.
 */

const PAGES_MAX = 8;

const activePage = () =>
  state.review.pages.find((p) => p.id === state.review.activePageId) || state.review.pages[0];

const commentPageId = (c) => c.pageId || state.review.pages[0]?.id;

const ensurePages = () => {
  if (!state.review.pages.length) {
    state.review.pages = [
      {
        id: crypto.randomUUID(),
        label: state.review.title || "Page 1",
        kind: state.review.resolvedKind,
        path: state.review.resolvedPath,
        html: state.review.resolvedHtml,
        source: state.review.resolvedSource,
        url: state.review.url,
      },
    ];
  }
  // activePage() falls back to pages[0] whenever activePageId doesn't
  // match anything, which would make this check always pass if it
  // called activePage() itself — check membership directly instead,
  // otherwise activePageId can stay "" forever and every pin (which
  // filters on the raw activePageId, not the fallback) silently
  // fails to match its page and never renders
  if (!state.review.pages.some((p) => p.id === state.review.activePageId)) {
    state.review.activePageId = state.review.pages[0].id;
  }
  state.comments.forEach((c) => {
    if (!c.pageId) c.pageId = commentPageId(c);
  });
  save();
};

// Details-panel re-resolution (and its live-URL field) still write to
// the flat state.review.resolved*/url fields — this keeps page 1
// in step with those so the canvas actually reflects the change
const syncPageOneFromResolved = () => {
  if (!state.review.pages.length) return;
  const p0 = state.review.pages[0];
  p0.kind = state.review.resolvedKind;
  p0.path = state.review.resolvedPath;
  p0.html = state.review.resolvedHtml;
  p0.source = state.review.resolvedSource;
  p0.url = state.review.url;
  save();
};

// a synced page carries only metadata (id/label/kind/path/url), same
// as the review's own primary file — this re-resolves the actual
// html/source content from the repo, live, same as joining a review
// already does for page 1
const fetchPageContent = async (owner, repo, pageMeta, token) => {
  if (pageMeta.url || !pageMeta.path) {
    return { ...pageMeta, kind: pageMeta.url ? pageMeta.kind : null, html: "", source: "" };
  }
  const result = await fetchResolvedFile(owner, repo, { kind: pageMeta.kind, path: pageMeta.path }, token);
  if (result.error) return { ...pageMeta, kind: null, html: "", source: "" };
  return {
    ...pageMeta,
    kind: result.kind,
    html: result.kind === "html" ? result.html : "",
    source: result.kind === "source" ? result.source : "",
  };
};

const setActivePage = (id) => {
  if (id === state.review.activePageId) return;
  state.review.activePageId = id;
  save();
  renderPageTabs();
  renderPrototypeSurface();
  renderPins();
};

const renderPageTabs = () => {
  el.pageTabs.classList.toggle("is-hidden", state.review.pages.length < 2);
  el.pageTabs.innerHTML = "";

  state.review.pages.forEach((p) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `page-tab${p.id === state.review.activePageId ? " is-on" : ""}`;
    tab.textContent = p.label || "Page";
    tab.title = p.label || "Page";
    tab.addEventListener("click", () => setActivePage(p.id));
    el.pageTabs.appendChild(tab);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "page-tab-add";
  addBtn.setAttribute("aria-label", "Add page");
  addBtn.disabled = state.review.pages.length >= PAGES_MAX;
  addBtn.textContent = "+";
  addBtn.addEventListener("click", openPageAddModal);
  el.pageTabs.appendChild(addBtn);
};

const closePageAddModal = () => {
  el.pageAddModal.classList.add("is-hidden");
  hideCatcher();
};

const openPageAddModal = () => {
  if (state.review.pages.length >= PAGES_MAX) return;
  el.pageAddLabel.value = "";
  el.pageAddStatus.textContent = "";
  el.pageAddModal.classList.remove("is-hidden");
  showCatcher(closePageAddModal, "workspace");
};

el.pageAddClose.addEventListener("click", closePageAddModal);

el.pageAddChooseFile.addEventListener("click", () => {
  const repo = state.review.repo;
  if (!repo) {
    el.pageAddStatus.textContent = "No repository connected.";
    return;
  }
  openFilePicker(repo, async (path) => {
    closeFilePicker();
    el.pageAddStatus.textContent = "Loading…";
    const parsed = parseGithubRepo(repo);
    const result = await resolveManualFile(parsed.owner, parsed.repo, path, githubToken);
    if (result.error) {
      el.pageAddStatus.textContent = result.error;
      return;
    }
    const page = {
      id: crypto.randomUUID(),
      label: el.pageAddLabel.value.trim() || result.path,
      kind: result.kind,
      path: result.path,
      html: result.kind === "html" ? result.html : "",
      source: result.kind === "source" ? result.source : "",
      url: "",
    };
    state.review.pages.push(page);
    state.review.activePageId = page.id;
    save();
    scheduleSync();
    closePageAddModal();
    renderPageTabs();
    renderPrototypeSurface();
    renderPins();
  });
});

const renderPrototypeSurface = () => {
  el.frameFallback.classList.add("is-hidden");
  el.sourceView.classList.add("is-hidden");
  el.protoFrame.classList.remove("is-hidden");

  const page = activePage();
  const manualUrl = page.url;

  if (manualUrl) {
    loadPrototype(manualUrl);
    return;
  }

  if (page.kind === "html") {
    el.protoFrame.removeAttribute("src");
    el.protoFrame.srcdoc = page.html;
    return;
  }

  if (page.kind === "source") {
    el.protoFrame.classList.add("is-hidden");
    el.sourceCode.textContent = page.source;
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

// "Copy comment link" puts #comment-<id> in the URL — this is what
// makes that link actually go somewhere instead of just looking like
// one. Checked again after the first sync pull in case the linked
// comment only exists on the synced snapshot, not locally yet.
const openThreadFromHash = () => {
  const match = /^#comment-(.+)$/.exec(location.hash);
  if (match && findComment(match[1])) openThreadModal(match[1]);
};

const openWorkspace = () => {
  el.screenOnboarding.classList.add("is-hidden");
  el.screenWorkspace.classList.remove("is-hidden");
  ensurePages();
  renderPageTabs();
  fitStage();
  renderWorkspace();
  renderPrototypeSurface();
  updateSyncUI();
  openThreadFromHash();
  pullRemoteComments().then(openThreadFromHash);
};

const resetToWizard = () => {
  state = blankState();
  save();
  el.menuModal.classList.add("is-hidden");
  el.detailsPanel.classList.add("is-hidden");
  el.composer.classList.add("is-hidden");
  el.threadModal.classList.add("is-hidden");
  openThreadId = null;
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

/* ---------- collapsible rail sections ----------
 * The floating comment rail's two pieces (Comments, Ready to go?)
 * each collapse independently via their own header row. Purely a
 * per-browser display preference, same as "mark as unread" above —
 * persisted so a reload doesn't spring them back open, but never
 * synced or shown to anyone else.
 */

const RAIL_COLLAPSE_KEY = "tminus.railCollapsed";

const readCollapsedRailSections = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem(RAIL_COLLAPSE_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

// Comments always opens expanded (persist: false) — a reviewer's
// most important panel shouldn't stay collapsed just because a past
// session left it that way. Ready to go? still remembers its state.
const wireRailSection = (toggleBtn, bodyEl, sectionId, persist = true) => {
  const apply = (isCollapsed) => {
    bodyEl.classList.toggle("is-hidden", isCollapsed);
    toggleBtn.classList.toggle("is-collapsed", isCollapsed);
    toggleBtn.setAttribute("aria-expanded", String(!isCollapsed));
  };
  apply(persist && readCollapsedRailSections().has(sectionId));

  toggleBtn.addEventListener("click", () => {
    const nowCollapsed = !toggleBtn.classList.contains("is-collapsed");
    if (persist) {
      const collapsed = readCollapsedRailSections();
      if (nowCollapsed) collapsed.add(sectionId);
      else collapsed.delete(sectionId);
      localStorage.setItem(RAIL_COLLAPSE_KEY, JSON.stringify([...collapsed]));
    }
    apply(nowCollapsed);
  });
};

wireRailSection(el.railToggleComments, el.railBodyComments, "comments", false);
wireRailSection(el.railToggleVote, el.railBodyVote, "vote");

/* ---------- hamburger menu (macOS-style: click outside to dismiss) ---------- */

const closeMenu = () => {
  el.menuModal.classList.add("is-hidden");
  hideCatcher();
};

el.hamburgerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const opening = el.menuModal.classList.contains("is-hidden");
  if (opening) {
    el.menuModal.classList.remove("is-hidden");
    showCatcher(closeMenu, "workspace");
  } else {
    closeMenu();
  }
});
// copies the review's own URL (no comment hash) so a teammate landing
// on it just sees the workspace as it stands, same as the thread
// modal's "Copy comment link" but for the whole review rather than
// one thread
el.shareReview.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}`;
  try {
    await navigator.clipboard.writeText(url);
    el.shareReviewLabel.textContent = "Copied!";
  } catch {
    el.shareReviewLabel.textContent = "Couldn't copy";
  }
  // leave the menu open just long enough to show the label flip back,
  // rather than closing before there's anything to see
  window.setTimeout(() => {
    el.shareReviewLabel.textContent = "Share";
    closeMenu();
  }, 1200);
});

el.newReview.addEventListener("click", () => {
  closeMenu();
  resetToWizard();
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

el.closeDetails.addEventListener("click", () => el.detailsPanel.classList.add("is-hidden"));
el.cancelEditDetails.addEventListener("click", () => el.detailsPanel.classList.add("is-hidden"));

el.editUrl.addEventListener("input", () => {
  el.editUrlWarning.classList.toggle("is-hidden", !looksLikeGithubRepoPage(el.editUrl.value));
});

// applyResolveResult() has already saved state.review by the time this
// runs — this only updates the status text and the live preview
const renderEditResolveStatus = (result) => {
  if (result.error) {
    el.editResolveStatus.textContent = result.error;
  } else {
    el.editResolveStatus.textContent = `Resolved — ${result.path} (${result.kind === "html" ? "rendered" : "source only"})`;
  }
  if (!el.editUrl.value.trim()) renderPrototypeSurface();
};

el.editResolveBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  const repo = el.editRepo.value.trim();
  if (!repo) {
    el.editResolveStatus.textContent = "Enter a repository first";
    return;
  }

  el.editResolveStatus.textContent = "Searching…";
  const result = await resolveEntryFromRepo(repo, githubToken);
  applyResolveResult(result);
  renderEditResolveStatus(result);
});

el.editResolveManualBtn.addEventListener("click", (e) => {
  e.preventDefault();
  const repo = el.editRepo.value.trim();
  if (!repo) {
    el.editResolveStatus.textContent = "Enter a repository first";
    return;
  }
  openFilePicker(repo, async (path) => {
    closeFilePicker();
    const parsed = parseGithubRepo(repo);
    el.editResolveStatus.textContent = "Loading…";
    const result = await resolveManualFile(parsed.owner, parsed.repo, path, githubToken);
    applyResolveResult(result);
    renderEditResolveStatus(result);
  });
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
        el.editResolveStatus.textContent = describeFetchError(err);
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
  syncPageOneFromResolved();

  renderWorkspace();
  if (surfaceChanged) renderPrototypeSurface();
  scheduleSync();
  el.detailsPanel.classList.add("is-hidden");
});

/* ---------- go / no-go ---------- */

const vote = (value) => {
  if (value) state.votes[deviceId] = value;
  else delete state.votes[deviceId];
  save();
  scheduleSync();
  renderWorkspace();
};

// clicking the already-active option clears the vote; clicking the
// other one switches to it — a plain toggle, no separate "unvote" control
el.voteGo.addEventListener("click", () => vote(state.votes[deviceId] === "go" ? "" : "go"));
el.voteNogo.addEventListener("click", () => vote(state.votes[deviceId] === "nogo" ? "" : "nogo"));

/* ---------- comment placement + composer ---------- */

el.overlay.addEventListener("click", (e) => {
  if (mode !== "comment" || !state.creator.name) return;
  if (e.target.classList.contains("pin-dot")) return;

  const rect = el.stage.getBoundingClientRect();
  anchor = {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };

  el.composerAvatar.style.setProperty("--avatar-color", authorColor(state.creator.name || "T"));
  el.composerAvatar.textContent = (state.creator.name || "T").charAt(0).toUpperCase();
  el.composer.classList.remove("is-hidden");
  positionComposerAt(e.clientX, e.clientY);
  // no auto-focus here: the pill should open collapsed (placeholder +
  // send only) and expand — revealing the close/emoji buttons — only
  // once the reviewer actually clicks into it
});

el.composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = el.commentBody.value.trim();
  if (!body || !anchor || !state.creator.name) return;

  const now = new Date().toISOString();
  state.comments.push({
    id: crypto.randomUUID(),
    author: state.creator.name,
    body,
    tags: [],
    reactions: {},
    resolved: false,
    createdAt: now,
    updatedAt: now,
    replies: [],
    pageId: state.review.activePageId,
    ...dedupeAnchor(anchor.x, anchor.y),
  });

  save();
  scheduleSync();
  closeComposer();
  renderWorkspace();
});

el.composerClose.addEventListener("click", closeComposer);

el.commentBody.addEventListener("input", () => {
  el.composerSend.disabled = !el.commentBody.value.trim();
  autoGrowTextarea(el.commentBody);
});

el.composerEmojiToggle.addEventListener("click", () => {
  openEmojiInsertPicker(el.composerEmojiToggle, el.commentBody);
});

/* ---------- boot ---------- */

el.mastheadDate.textContent = `// ${shortDate(new Date()).toUpperCase()}`;

el.inCreatorName.value = state.creator.name;
el.inCreatorEmail.value = state.creator.email;
el.inRepo.value = state.review.repo;
if (githubToken) el.inToken.value = githubToken;
el.inTitle.value = state.review.title;
el.inTzero.value = toDateInput(state.review.tzero);
initBriefFields(el.briefChecklist, el.addBriefField, state.review.briefAreas);
initBriefFields(el.editBriefChecklist, el.editAddBriefField, []);

setMode("interact");

if (state.created) {
  openWorkspace();
} else {
  renderStep();
}

setInterval(() => {
  if (state.created) el.countdown.textContent = countdown(state.review.tzero);
}, 1000);

setInterval(pullRemoteComments, 20000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) pullRemoteComments();
});
