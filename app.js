"use strict";

const DB_NAME = "daymark-local";
const DB_VERSION = 1;
const TASKS_STORE = "todos";
const NOTES_STORE = "notes";
const FOCUS_KEY = "daymark-focus-v1";
const PAGE_TITLES = { todo: "TaskKar", notes: "Notes", focus: "Focus", donation: "Donation", trash: "Trash" };
const ICON = (name, extraClass = "") =>
  `<svg class="icon${extraClass ? ` ${extraClass}` : ""}" aria-hidden="true"><use href="#i-${name}" xlink:href="#i-${name}"></use></svg>`;

const ui = {
  main: document.querySelector("#main-content"),
  title: document.querySelector("#page-title"),
  nav: document.querySelector(".navigation-bar"),
  fab: document.querySelector("#fab"),
  fabActions: document.querySelector("#fab-actions"),
  snackbar: document.querySelector("#snackbar"),
  connectionBanner: document.querySelector("#connection-banner"),
  editorDialog: document.querySelector("#editor-dialog"),
  confirmDialog: document.querySelector("#confirm-dialog"),
  settingsDialog: document.querySelector("#settings-dialog"),
  editorForm: document.querySelector("#editor-form"),
  searchField: document.querySelector("#search-field"),
  searchInput: document.querySelector("#search-input"),
};

let focusStorageWarning = "";

const state = {
  page: initialPage(),
  filter: "active",
  query: "",
  tasks: [],
  notes: [],
  editing: null,
  pendingDelete: null,
  quickAddOpen: false,
  searchOpen: false,
  focus: loadFocusState(),
  deferredInstallPrompt: null,
  snackbarAction: null,
  snackbarTimeout: 0,
};

function todayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

function twoDigits(value) {
  return value < 10 ? `0${value}` : String(value);
}

function formatTaskDue(task) {
  const date = task.dueDate;
  if (!date) return task.dueTime ? formatTaskTime(task.dueTime) : "";
  const today = todayDate();
  const tomorrow = offsetDate(1);
  const dateLabel = date < today
    ? `Overdue · ${formatTaskDate(date)}`
    : date > tomorrow
      ? formatTaskDate(date)
      : "";
  const parts = [dateLabel, task.dueTime ? formatTaskTime(task.dueTime) : ""].filter(Boolean);
  return parts.join(" · ");
}

function formatTaskDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function formatTaskTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function initialPage() {
  const requested = window.location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(PAGE_TITLES, requested) ? requested : "todo";
}

function offsetDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}

function makeId() {
  if (window.crypto && window.crypto.getRandomValues) {
    const values = new Uint32Array(4);
    window.crypto.getRandomValues(values);
    return Array.prototype.map.call(values, (value) => value.toString(16)).join("-");
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local offline storage."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(TASKS_STORE)) {
        database.createObjectStore(TASKS_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(NOTES_STORE)) {
        database.createObjectStore(NOTES_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error("Could not open your local database."));
    request.onblocked = () => reject(new Error("Please close any other TaskKar tabs, then reload the page."));
  });
  return databasePromise;
}

async function readRecords(storeName) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not read your saved items."));
    transaction.onabort = () => reject(transaction.error || new Error("Could not read your saved items."));
  });
}

async function writeRecord(storeName, record) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(record);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("Your changes could not be saved."));
    transaction.onerror = () => reject(transaction.error || new Error("Your changes could not be saved."));
  });
}

async function updateRecord(storeName, id, update) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    let missingRecord = false;
    request.onsuccess = () => {
      if (!request.result) {
        missingRecord = true;
        transaction.abort();
        return;
      }
      store.put(Object.assign({}, request.result, update));
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(missingRecord
      ? new Error("This item could not be found. Refresh the page and try again.")
      : transaction.error || new Error("Your changes could not be saved."));
    transaction.onerror = () => reject(transaction.error || new Error("Your changes could not be saved."));
  });
}

async function removeRecord(storeName, id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    let missingRecord = false;
    request.onsuccess = () => {
      if (!request.result) {
        missingRecord = true;
        transaction.abort();
        return;
      }
      store.delete(id);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(missingRecord
      ? new Error("This item could not be found. Refresh the page and try again.")
      : transaction.error || new Error("The item could not be deleted."));
    transaction.onerror = () => reject(transaction.error || new Error("The item could not be deleted."));
  });
}

async function refreshData() {
  [state.tasks, state.notes] = await Promise.all([
    readRecords(TASKS_STORE),
    readRecords(NOTES_STORE),
  ]);
  if (window.TaskKarAndroid && typeof window.TaskKarAndroid.updateTodos === "function") {
    const widgetTodos = state.tasks
      .filter((task) => !task.trashed && !task.completed)
      .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "") ||
        (a.dueTime || "").localeCompare(b.dueTime || "") || b.updatedAt - a.updatedAt)
      .map((task) => ({ title: task.title, due: formatTaskDue(task) }));
    try {
      window.TaskKarAndroid.updateTodos(JSON.stringify(widgetTodos));
    } catch (error) {
      showSnackbar(error.message || "The Todo widget could not be updated.");
    }
  }
  document.querySelectorAll("use[href]").forEach((use) => {
    if (!use.hasAttribute("xlink:href")) {
      use.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", use.getAttribute("href"));
    }
  });

  render();
}

function syncViewportHeight() {
  const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-height", `${Math.round(viewportHeight)}px`);
}

syncViewportHeight();
window.addEventListener("resize", syncViewportHeight);
if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewportHeight);

function showSnackbar(message, undo) {
  window.clearTimeout(state.snackbarTimeout);
  state.snackbarAction = undo || null;
  ui.snackbar.textContent = "";
  const label = document.createElement("span");
  label.textContent = message;
  ui.snackbar.append(label);
  if (undo) {
    const button = document.createElement("button");
    button.className = "snackbar__undo";
    button.type = "button";
    button.textContent = "Undo";
    button.addEventListener("click", async () => {
      const action = state.snackbarAction;
      state.snackbarAction = null;
      hideSnackbar();
      if (action) await runSafely(action);
    }, { once: true });
    ui.snackbar.append(button);
  }
  ui.snackbar.hidden = false;
  state.snackbarTimeout = window.setTimeout(hideSnackbar, 5000);
}

function hideSnackbar() {
  window.clearTimeout(state.snackbarTimeout);
  ui.snackbar.hidden = true;
  state.snackbarAction = null;
}

async function runSafely(action) {
  try {
    await action();
    await refreshData();
  } catch (error) {
    showSnackbar(error instanceof DOMException && error.name === "QuotaExceededError"
      ? "Device storage is full. Free some space and try again."
      : error.message || "Your changes could not be saved. Please try again.");
  }
}

function emptyState(title, description, actionLabel, actionId) {
  return `
    <section class="empty-state" aria-label="${escapeHtml(title)}">
      <span class="empty-state__icon">${ICON("check-circle")}</span>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
      ${actionLabel ? `<button class="filled-button empty-state__action" id="${actionId}" type="button">${escapeHtml(actionLabel)}</button>` : ""}
    </section>`;
}

function matchesQuery(...values) {
  const query = state.query.trim().toLocaleLowerCase();
  return !query || values.some((value) => String(value == null ? "" : value).toLocaleLowerCase().includes(query));
}

function renderTask(task) {
  const label = task.completed ? "Mark as active" : "Mark as completed";
  const dueLabel = formatTaskDue(task);
  return `
    <article class="task-row${task.completed ? " is-checked" : ""}">
      <button class="task-checkbox${task.completed ? " is-checked" : ""}" type="button" data-toggle-task="${escapeHtml(task.id)}" aria-label="${label}: ${escapeHtml(task.title)}" aria-pressed="${task.completed}"></button>
      <button class="task-copy" type="button" data-edit-task="${escapeHtml(task.id)}" aria-label="Edit ${escapeHtml(task.title)}">
        <span class="task-name">${escapeHtml(task.title)}</span>
        ${task.details ? `<span class="task-details">${escapeHtml(task.details)}</span>` : ""}
        ${dueLabel ? `<span class="task-due">${escapeHtml(dueLabel)}</span>` : ""}
      </button>
      <div class="popup-anchor">
        <button class="icon-button row-action" type="button" data-open-actions="${escapeHtml(task.id)}" aria-label="Actions for ${escapeHtml(task.title)}" aria-expanded="false">${ICON("more")}</button>
        <div class="popup-menu popup-menu--right" data-item-menu="${escapeHtml(task.id)}" hidden>
          <button class="popup-menu__item" type="button" data-edit-task="${escapeHtml(task.id)}">${ICON("edit")}Edit task</button>
          <button class="popup-menu__item" type="button" data-trash-task="${escapeHtml(task.id)}">${ICON("trash")}Move to trash</button>
        </div>
      </div>
    </article>`;
}

function renderTodos() {
  const today = todayDate();
  const tomorrow = offsetDate(1);
  const tasks = state.tasks
    .filter((task) => !task.trashed && (state.filter === "active" ? !task.completed : task.completed))
    .filter((task) => matchesQuery(task.title, task.details, task.dueDate))
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "") ||
      (a.dueTime || "").localeCompare(b.dueTime || "") || b.updatedAt - a.updatedAt);

  if (!tasks.length) {
    const activeEmpty = state.filter === "active";
    return `
      <div class="connected-filters" role="group" aria-label="Filter todos">
        <button class="filter-button${activeEmpty ? " is-selected" : ""}" data-filter="active" type="button" aria-pressed="${activeEmpty}">Active</button>
        <button class="filter-button${!activeEmpty ? " is-selected" : ""}" data-filter="completed" type="button" aria-pressed="${!activeEmpty}">Completed</button>
      </div>
      ${emptyState(
        activeEmpty ? (state.query ? "No matching todos" : "A little breathing room")
          : (state.query ? "No matching todos" : "Nothing checked off yet"),
        activeEmpty ? (state.query ? "Try another search, or add a new todo." : "Add your first task and make today yours.")
          : "Tasks you finish will be waiting here.",
        activeEmpty ? "Add a todo" : null,
        "empty-add-todo",
      )}`;
  }

  const sections = [
    { key: "today", title: "Today", test: (task) => !task.dueDate || task.dueDate <= today },
    { key: "tomorrow", title: "Tomorrow", test: (task) => task.dueDate === tomorrow },
    { key: "later", title: "Later", test: (task) => task.dueDate > tomorrow },
  ].map((section) => ({
    key: section.key,
    title: section.title,
    tasks: tasks.filter(section.test),
  }))
    .filter((section) => section.tasks.length);
  const groupHtml = sections.map((section, index) => `
    <section class="task-section" aria-labelledby="heading-${section.key}">
      ${index ? '<hr class="section-divider">' : ""}
      <h2 class="day-heading" id="heading-${section.key}">${section.title}</h2>
      ${section.tasks.map(renderTask).join("")}
    </section>`).join("");

  return `
    <div class="connected-filters" role="group" aria-label="Filter todos">
      <button class="filter-button${state.filter === "active" ? " is-selected" : ""}" data-filter="active" type="button" aria-pressed="${state.filter === "active"}">Active</button>
      <button class="filter-button${state.filter === "completed" ? " is-selected" : ""}" data-filter="completed" type="button" aria-pressed="${state.filter === "completed"}">Completed</button>
    </div>
    <div class="task-list">${groupHtml}</div>`;
}

function renderNotes() {
  const notes = state.notes
    .filter((note) => !note.trashed)
    .filter((note) => matchesQuery(note.title, note.body))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (!notes.length) {
    return emptyState(
      state.query ? "No matching notes" : "A space for your thoughts",
      state.query ? "Try a different search, or write something new."
        : "Capture an idea, a reminder, or anything you want to remember.",
      "Write a note",
      "empty-add-note",
    );
  }

  return `<div class="notes-list">${notes.map((note) => `
    <article class="note-card">
      <div class="note-card__heading">
        <button class="task-copy" type="button" data-edit-note="${escapeHtml(note.id)}" aria-label="Edit ${escapeHtml(note.title)}">
          <h2 class="note-card__title">${escapeHtml(note.title)}</h2>
        </button>
        <div class="popup-anchor">
          <button class="icon-button row-action" type="button" data-open-actions="${escapeHtml(note.id)}" aria-label="Actions for ${escapeHtml(note.title)}" aria-expanded="false">${ICON("more")}</button>
          <div class="popup-menu popup-menu--right" data-item-menu="${escapeHtml(note.id)}" hidden>
            <button class="popup-menu__item" type="button" data-edit-note="${escapeHtml(note.id)}">${ICON("edit")}Edit note</button>
            <button class="popup-menu__item" type="button" data-trash-note="${escapeHtml(note.id)}">${ICON("trash")}Move to trash</button>
          </div>
        </div>
      </div>
      <p class="note-card__body">${escapeHtml(note.body)}</p>
    </article>`).join("")}</div>`;
}

function renderTrashCard(item, type) {
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);
  const body = escapeHtml(type === "task" ? item.details : item.body);
  return `
    <article class="trash-card">
      <div class="trash-card__heading"><h3 class="trash-card__title">${title}</h3></div>
      <p class="trash-card__body">${body}</p>
      <div class="trash-card__actions">
        <button class="text-button" type="button" data-delete-${type}="${id}">${ICON("trash")}Delete forever</button>
        <button class="text-button" type="button" data-restore-${type}="${id}">${ICON("restore")}Restore</button>
      </div>
    </article>`;
}

function renderTrash() {
  const tasks = state.tasks.filter((item) => item.trashed && matchesQuery(item.title, item.details));
  const notes = state.notes.filter((item) => item.trashed && matchesQuery(item.title, item.body));
  if (!tasks.length && !notes.length) {
    return emptyState(
      "Trash is empty",
      "Items you move here stay until you restore or permanently delete them.",
      null,
      null,
    );
  }
  return `<div class="trash-list">
    ${tasks.length ? `<section><h2 class="subsection-heading">Todos</h2>${tasks.map((task) => renderTrashCard(task, "task")).join("")}</section>` : ""}
    ${notes.length ? `<section><h2 class="subsection-heading">Notes</h2>${notes.map((note) => renderTrashCard(note, "note")).join("")}</section>` : ""}
  </div>`;
}

function renderDonation() {
  return `
    <section class="donation-screen" aria-label="Support TaskKar">
      <span class="donation-screen__icon">${ICON("coffee")}</span>
      <p class="donation-screen__eyebrow">MADE WITH CARE</p>
      <h2>Enjoying TaskKar?</h2>
      <p class="donation-screen__description">If TaskKar has made your day a little easier, you can support its creator with a chai. Every contribution is optional and appreciated.</p>
      <a class="donation-link donation-link--primary" href="https://www.buymeachai.in/kindujjwal" target="_blank" rel="noopener noreferrer">
        ${ICON("coffee")}<span>Buy me a chai</span>${ICON("arrow", "donation-link__arrow")}
      </a>
      <a class="donation-link donation-link--outlined" href="https://github.com/kindujjwal" target="_blank" rel="noopener noreferrer">
        ${ICON("code")}<span>GitHub · kindujjwal</span>${ICON("arrow", "donation-link__arrow")}
      </a>
      <p class="donation-screen__footnote">Both links open an external website. Your tasks and notes stay on your device.</p>
    </section>`;
}

function focusMarkup() {
  const minutes = Math.floor(state.focus.remainingSeconds / 60);
  const seconds = state.focus.remainingSeconds % 60;
  const value = `${twoDigits(minutes)}:${twoDigits(seconds)}`;
  const isRunning = Boolean(state.focus.endAt);
  return `
    <section class="focus-screen" aria-label="Focus timer">
      <span class="focus-screen__icon">${ICON("focus")}</span>
      <h2>Focus time</h2>
      <p class="focus-screen__subtitle">A little space to do one thing well.</p>
      <div class="timer-ring${isRunning ? " is-running" : ""}" id="timer-ring" role="timer" aria-label="Time remaining">
        <div>
          <div class="timer-readout" id="timer-readout" aria-live="off">${value}</div>
          <div class="timer-caption" id="timer-caption">${isRunning ? "You're in the zone" : "One thing at a time"}</div>
        </div>
      </div>
      <div class="timer-controls">
        <button class="icon-button timer-reset" id="reset-focus" type="button" aria-label="Reset timer" ${isRunning ? "disabled" : ""}>${ICON("reset")}</button>
        <button class="filled-button" id="toggle-focus" type="button">${ICON(isRunning ? "pause" : "play")}<span>${isRunning ? "Pause" : "Start"}</span></button>
      </div>
      <div class="duration-picker" role="group" aria-label="Focus session length">
        <button class="duration-choice${state.focus.duration === 25 ? " is-selected" : ""}" data-duration="25" type="button" ${isRunning ? "disabled" : ""}>25 min</button>
        <button class="duration-choice${state.focus.duration === 50 ? " is-selected" : ""}" data-duration="50" type="button" ${isRunning ? "disabled" : ""}>50 min</button>
      </div>
      <form class="focus-custom-form" id="custom-focus-form" novalidate>
        <label class="focus-custom-label" for="custom-focus-duration">Custom focus duration</label>
        <div class="focus-custom-controls">
          <input class="focus-custom-input" id="custom-focus-duration" type="number" inputmode="numeric" min="1" max="720" step="1" placeholder="Minutes" aria-describedby="custom-focus-help" ${isRunning ? "disabled" : ""}>
          <button class="duration-choice" id="apply-custom-duration" type="submit" ${isRunning ? "disabled" : ""}>Set timer</button>
        </div>
        <span class="focus-custom-help" id="custom-focus-help">Choose any whole number from 1 to 720 minutes.</span>
      </form>
    </section>`;
}

function render() {
  ui.title.textContent = PAGE_TITLES[state.page];
  ui.searchField.hidden = !state.searchOpen;
  ui.title.hidden = state.searchOpen;
  ui.fab.hidden = !((state.page === "todo" && state.filter === "active") || state.page === "notes");
  ui.fabActions.hidden = !state.quickAddOpen || state.page !== "todo";
  ui.fab.classList.toggle("is-open", state.quickAddOpen);
  ui.fab.setAttribute("aria-expanded", String(state.quickAddOpen));
  ui.fab.setAttribute("aria-label", state.quickAddOpen
    ? "Close add menu"
    : (state.page === "notes" ? "Add note" : "Add"));
  document.querySelectorAll(".navigation-item").forEach((button) => {
    const selected = button.dataset.page === state.page;
    button.classList.toggle("is-selected", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  ui.main.innerHTML = ({
    todo: renderTodos,
    notes: renderNotes,
    focus: focusMarkup,
    donation: renderDonation,
    trash: renderTrash,
  })[state.page]();
  updateFocusUi();
}

function closeMenus() {
  document.querySelectorAll(".popup-menu:not([hidden])").forEach((menu) => { menu.hidden = true; });
  document.querySelectorAll("[aria-expanded='true']").forEach((button) => {
    if (button.id === "menu-button" || button.id === "more-button" || button.hasAttribute("data-open-actions")) {
      button.setAttribute("aria-expanded", "false");
    }
  });
}

function closeQuickAdd() {
  if (!state.quickAddOpen) return;
  state.quickAddOpen = false;
  render();
}

function navigate(page, pushHistory = true) {
  if (!Object.prototype.hasOwnProperty.call(PAGE_TITLES, page) || state.page === page) {
    closeMenus();
    return;
  }
  closeMenus();
  state.page = page;
  state.quickAddOpen = false;
  state.searchOpen = false;
  state.query = "";
  ui.searchInput.value = "";
  if (pushHistory) {
    history.pushState({ taskkar: true, page }, "", `#${page}`);
  }
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function loadFocusState() {
  const initial = { duration: 25, remainingSeconds: 25 * 60, endAt: null };
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || "null");
    if (!saved || !Number.isInteger(saved.duration) || saved.duration < 1 || saved.duration > 720) return initial;
    const endAt = saved.endAt === null || saved.endAt === undefined ? null : Number(saved.endAt);
    if (!Number.isFinite(Number(saved.remainingSeconds)) || Number(saved.remainingSeconds) < 0
      || (endAt !== null && (!Number.isFinite(endAt) || endAt <= 0))) {
      focusStorageWarning = "The saved focus timer was invalid, so it has been reset.";
      return initial;
    }
    const remainingSeconds = endAt
      ? Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      : Math.max(0, Math.min(saved.duration * 60, Number(saved.remainingSeconds)));
    return {
      duration: saved.duration,
      remainingSeconds,
      endAt: remainingSeconds > 0 ? endAt : null,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      focusStorageWarning = "The saved focus timer was unreadable, so it has been reset.";
      return initial;
    }
    focusStorageWarning = "Focus timer settings could not be read from this browser.";
    return initial;
  }
}

function persistFocusState() {
  try {
    localStorage.setItem(FOCUS_KEY, JSON.stringify(state.focus));
  } catch (error) {
    showSnackbar(error.message || "The timer settings could not be saved on this device.");
  }
}

function updateFocusUi() {
  const readout = document.querySelector("#timer-readout");
  if (!readout) return;
  const minutes = Math.floor(state.focus.remainingSeconds / 60);
  const seconds = state.focus.remainingSeconds % 60;
  readout.textContent = `${twoDigits(minutes)}:${twoDigits(seconds)}`;
  const isRunning = Boolean(state.focus.endAt);
  const toggle = document.querySelector("#toggle-focus");
  toggle.innerHTML = `${ICON(isRunning ? "pause" : "play")}<span>${isRunning ? "Pause" : "Start"}</span>`;
  toggle.setAttribute("aria-label", `${isRunning ? "Pause" : "Start"} focus timer`);
  document.querySelector("#timer-caption").textContent = isRunning
    ? "You're in the zone"
    : (state.focus.remainingSeconds === 0 ? "Beautifully done. Take a breath." : "One thing at a time");
  document.querySelector("#timer-ring").classList.toggle("is-running", isRunning);
  document.querySelector("#reset-focus").disabled = isRunning;
  document.querySelectorAll("[data-duration]").forEach((button) => {
    const selected = Number(button.dataset.duration) === state.focus.duration;
    button.classList.toggle("is-selected", selected);
    button.disabled = isRunning;
  });
  const usingCustomDuration = state.focus.duration !== 25 && state.focus.duration !== 50;
  const customDurationInput = document.querySelector("#custom-focus-duration");
  const customDurationButton = document.querySelector("#apply-custom-duration");
  customDurationInput.disabled = isRunning;
  customDurationButton.disabled = isRunning;
  const customDurationLabel = document.querySelector(".focus-custom-label");
  customDurationLabel.classList.toggle("is-disabled", isRunning);
  customDurationButton.classList.toggle("is-selected", usingCustomDuration);
  if (document.activeElement !== customDurationInput) {
    customDurationInput.value = usingCustomDuration ? String(state.focus.duration) : "";
  }
}

function tickFocusTimer() {
  if (!state.focus.endAt) return;
  const next = Math.max(0, Math.ceil((state.focus.endAt - Date.now()) / 1000));
  if (next !== state.focus.remainingSeconds) {
    state.focus.remainingSeconds = next;
    if (next === 0) {
      state.focus.endAt = null;
      showSnackbar("Focus session complete. You did good work.");
    }
    persistFocusState();
    updateFocusUi();
  }
}

function openEditor(kind, item = null) {
  closeQuickAdd();
  closeMenus();
  state.editing = { kind, item };
  const isTask = kind === "task";
  document.querySelector("#editor-title").textContent = item ? `Edit ${isTask ? "todo" : "note"}` : (isTask ? "Add todo" : "New note");
  document.querySelector("#task-fields").hidden = !isTask;
  document.querySelector("#note-fields").hidden = isTask;
  document.querySelector("#task-title-error").hidden = true;
  document.querySelector("#note-title-error").hidden = true;
  if (isTask) {
    document.querySelector("#task-title").value = item ? item.title : "";
    document.querySelector("#task-details").value = item ? item.details : "";
    setTaskDate((item && item.dueDate) || todayDate());
    setTaskTime((item && item.dueTime) || "");
  } else {
    document.querySelector("#note-title").value = item ? item.title : "";
    document.querySelector("#note-body").value = item ? item.body : "";
  }
  openDialog(ui.editorDialog);
  requestAnimationFrame(() => document.querySelector(isTask ? "#task-title" : "#note-title").focus());
}

function openDialog(dialog) {
  if (dialog.open) return;
  dialog.showModal();
  document.body.classList.add("dialog-open");
}

function setTaskDate(value) {
  const input = document.querySelector("#task-due-date");
  input.value = value;
  input.classList.toggle("is-hidden", value === todayDate() || value === offsetDate(1));
  document.querySelector("#date-today").classList.toggle("is-selected", value === todayDate());
  document.querySelector("#date-tomorrow").classList.toggle("is-selected", value === offsetDate(1));
  document.querySelector("#date-custom-button").classList.toggle("is-selected", value !== todayDate() && value !== offsetDate(1));
}

function setTaskTime(value) {
  const input = document.querySelector("#task-due-time");
  input.value = value;
  const hasTime = Boolean(value);
  input.hidden = !hasTime;
  input.classList.toggle("is-hidden", !hasTime);
  document.querySelector("#task-time-clear").hidden = !hasTime;
  const toggle = document.querySelector("#task-time-toggle");
  toggle.textContent = hasTime ? "Change time" : "Add time";
  toggle.classList.toggle("is-selected", hasTime);
  toggle.setAttribute("aria-expanded", String(hasTime));
}

async function submitEditor(event) {
  event.preventDefault();
  const editing = state.editing || {};
  const kind = editing.kind;
  const item = editing.item;
  if (!kind) return;
  const isTask = kind === "task";
  const titleInput = document.querySelector(isTask ? "#task-title" : "#note-title");
  const title = titleInput.value.trim();
  const error = document.querySelector(isTask ? "#task-title-error" : "#note-title-error");
  if (!title) {
    error.hidden = false;
    titleInput.setAttribute("aria-invalid", "true");
    titleInput.focus();
    return;
  }
  error.hidden = true;
  titleInput.removeAttribute("aria-invalid");
  const now = Date.now();
  const record = isTask
    ? {
      id: item ? item.id : makeId(),
      title,
      details: document.querySelector("#task-details").value.trim(),
      dueDate: document.querySelector("#task-due-date").value || todayDate(),
      dueTime: document.querySelector("#task-due-time").value,
      completed: item ? item.completed : false,
      trashed: false,
      createdAt: item ? item.createdAt : now,
      updatedAt: now,
    }
    : {
      id: item ? item.id : makeId(),
      title,
      body: document.querySelector("#note-body").value.trim(),
      trashed: false,
      createdAt: item ? item.createdAt : now,
      updatedAt: now,
    };
  try {
    await writeRecord(isTask ? TASKS_STORE : NOTES_STORE, record);
    ui.editorDialog.close();
    state.editing = null;
    await refreshData();
    showSnackbar(item ? `${isTask ? "Todo" : "Note"} updated` : `${isTask ? "Todo" : "Note"} saved`);
  } catch (error) {
    showSnackbar(error instanceof DOMException && error.name === "QuotaExceededError"
      ? "Device storage is full. Free some space and try again."
      : error.message || "Your changes could not be saved. Please try again.");
  }
}

function askToDelete(type, id, itemTitle) {
  state.pendingDelete = { type, id };
  document.querySelector("#confirm-title").textContent = "Delete forever?";
  document.querySelector("#confirm-message").textContent =
    `“${itemTitle}” will be permanently deleted. This action cannot be undone.`;
  openDialog(ui.confirmDialog);
}

async function confirmDelete(event) {
  event.preventDefault();
  const pendingDelete = state.pendingDelete || {};
  const type = pendingDelete.type;
  const id = pendingDelete.id;
  if (!type || !id) return;
  try {
    await removeRecord(type === "task" ? TASKS_STORE : NOTES_STORE, id);
    ui.confirmDialog.close();
    state.pendingDelete = null;
    await refreshData();
    showSnackbar("Item permanently deleted");
  } catch (error) {
    showSnackbar(error.message || "The item could not be deleted. Please try again.");
  }
}

async function trashItem(type, id) {
  const item = (type === "task" ? state.tasks : state.notes).find((record) => record.id === id);
  if (!item) {
    showSnackbar("This item could not be found. Refresh the page and try again.");
    return;
  }
  await runSafely(async () => {
    await updateRecord(type === "task" ? TASKS_STORE : NOTES_STORE, id, { trashed: true, updatedAt: Date.now() });
    showSnackbar(`${type === "task" ? "Todo" : "Note"} moved to trash`, async () => {
      await updateRecord(type === "task" ? TASKS_STORE : NOTES_STORE, id, { trashed: false, updatedAt: Date.now() });
    });
  });
}

async function restoreItem(type, id) {
  await runSafely(async () => {
    await updateRecord(type === "task" ? TASKS_STORE : NOTES_STORE, id, { trashed: false, updatedAt: Date.now() });
    showSnackbar(`${type === "task" ? "Todo" : "Note"} restored`);
  });
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    showSnackbar("This todo could not be found. Refresh the page and try again.");
    return;
  }
  void runSafely(() => updateRecord(TASKS_STORE, id, { completed: !task.completed, updatedAt: Date.now() }));
}

function handleMainClick(event) {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    closeQuickAdd();
    render();
    return;
  }
  if (target.dataset.toggleTask) {
    toggleTask(target.dataset.toggleTask);
    return;
  }
  if (target.dataset.editTask) {
    const task = state.tasks.find((item) => item.id === target.dataset.editTask);
    if (task) openEditor("task", task);
    return;
  }
  if (target.dataset.editNote) {
    const note = state.notes.find((item) => item.id === target.dataset.editNote);
    if (note) openEditor("note", note);
    return;
  }
  if (target.dataset.openActions) {
    const id = target.dataset.openActions;
    const menu = target.closest(".popup-anchor").querySelector(`[data-item-menu="${CSS.escape(id)}"]`);
    const wasOpen = !menu.hidden;
    closeMenus();
    menu.hidden = wasOpen;
    target.setAttribute("aria-expanded", String(!wasOpen));
    return;
  }
  if (target.dataset.trashTask) {
    void trashItem("task", target.dataset.trashTask);
    closeMenus();
    return;
  }
  if (target.dataset.trashNote) {
    void trashItem("note", target.dataset.trashNote);
    closeMenus();
    return;
  }
  if (target.dataset.restoreTask) {
    void restoreItem("task", target.dataset.restoreTask);
    return;
  }
  if (target.dataset.restoreNote) {
    void restoreItem("note", target.dataset.restoreNote);
    return;
  }
  if (target.dataset.deleteTask) {
    const item = state.tasks.find((task) => task.id === target.dataset.deleteTask);
    if (item) askToDelete("task", item.id, item.title);
    return;
  }
  if (target.dataset.deleteNote) {
    const item = state.notes.find((note) => note.id === target.dataset.deleteNote);
    if (item) askToDelete("note", item.id, item.title);
    return;
  }
  if (target.id === "empty-add-todo") openEditor("task");
  if (target.id === "empty-add-note") openEditor("note");
  if (target.id === "toggle-focus") toggleFocusTimer();
  if (target.id === "reset-focus") resetFocusTimer();
  if (target.dataset.duration) changeFocusDuration(Number(target.dataset.duration));
}

function toggleFocusTimer() {
  if (state.focus.endAt) {
    state.focus.remainingSeconds = Math.max(0, Math.ceil((state.focus.endAt - Date.now()) / 1000));
    state.focus.endAt = null;
  } else {
    if (state.focus.remainingSeconds <= 0) {
      state.focus.remainingSeconds = state.focus.duration * 60;
    }
    state.focus.endAt = Date.now() + state.focus.remainingSeconds * 1000;
  }
  persistFocusState();
  updateFocusUi();
}

function resetFocusTimer() {
  if (state.focus.endAt) return;
  state.focus.remainingSeconds = state.focus.duration * 60;
  persistFocusState();
  updateFocusUi();
}

function changeFocusDuration(duration) {
  if (!Number.isInteger(duration) || duration < 1 || duration > 720) {
    showSnackbar("Choose a whole number between 1 and 720 minutes.");
    return false;
  }
  if (state.focus.endAt) return false;
  state.focus.duration = duration;
  state.focus.remainingSeconds = duration * 60;
  persistFocusState();
  updateFocusUi();
  return true;
}

function refreshConnectionBanner() {
  ui.connectionBanner.hidden = navigator.onLine;
}

async function requestInstall() {
  if (!state.deferredInstallPrompt) return;
  const prompt = state.deferredInstallPrompt;
  state.deferredInstallPrompt = null;
  document.querySelector("#install-button").hidden = true;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch (error) {
    showSnackbar(error.message || "TaskKar could not be installed right now.");
  }
}

document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const button = event.target.closest("button");
  if (!button || button.disabled || button.hidden) return;
  const bounds = button.getBoundingClientRect();
  const size = Math.max(bounds.width, bounds.height) * 2;
  const ripple = document.createElement("span");
  ripple.className = "ripple-ink";
  ripple.setAttribute("aria-hidden", "true");
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.left = `${event.clientX - bounds.left - size / 2}px`;
  ripple.style.top = `${event.clientY - bounds.top - size / 2}px`;
  button.append(ripple);
  ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
});

document.querySelector("#menu-button").addEventListener("click", (event) => {
  const menu = document.querySelector("#navigation-menu");
  const open = menu.hidden;
  closeMenus();
  menu.hidden = !open;
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

document.querySelector("#more-button").addEventListener("click", (event) => {
  const menu = document.querySelector("#more-menu");
  const open = menu.hidden;
  closeMenus();
  menu.hidden = !open;
  event.currentTarget.setAttribute("aria-expanded", String(open));
});

document.querySelector("#navigation-menu").addEventListener("click", (event) => {
  const button = event.target.closest("[data-navigate]");
  if (button) navigate(button.dataset.navigate);
});

document.querySelector("#open-search").addEventListener("click", () => {
  closeMenus();
  state.searchOpen = !state.searchOpen;
  state.query = "";
  ui.searchInput.value = "";
  render();
  if (state.searchOpen) ui.searchInput.focus();
});

document.querySelector("#open-settings").addEventListener("click", () => {
  closeMenus();
  openDialog(ui.settingsDialog);
});

document.querySelectorAll(".navigation-item").forEach((button) => {
  button.addEventListener("click", () => navigate(button.dataset.page));
});

const tabOrder = Array.from(document.querySelectorAll(".navigation-item"), (button) => button.dataset.page);
let swipeStart = null;
ui.main.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (event.pointerType !== "touch" && event.pointerType !== "mouse") return;
  if (event.target.closest("button, input, textarea, select, [contenteditable='true'], dialog")) return;
  swipeStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
});
window.addEventListener("pointerup", (event) => {
  if (!swipeStart || event.pointerId !== swipeStart.pointerId) {
    swipeStart = null;
    return;
  }
  const deltaX = event.clientX - swipeStart.x;
  const deltaY = event.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.25) return;
  const currentIndex = tabOrder.indexOf(state.page);
  const nextIndex = currentIndex + (deltaX < 0 ? 1 : -1);
  if (nextIndex >= 0 && nextIndex < tabOrder.length) navigate(tabOrder[nextIndex]);
});
window.addEventListener("pointercancel", () => { swipeStart = null; });

document.querySelector("#fab").addEventListener("click", () => {
  if (state.page === "notes") {
    openEditor("note");
    return;
  }
  state.quickAddOpen = !state.quickAddOpen;
  render();
});

document.querySelector("#quick-add-todo").addEventListener("click", () => openEditor("task"));
document.querySelector("#quick-add-note").addEventListener("click", () => openEditor("note"));
document.querySelector("#editor-form").addEventListener("submit", submitEditor);
document.querySelector("#confirm-form").addEventListener("submit", confirmDelete);
ui.main.addEventListener("click", handleMainClick);

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => button.closest("dialog").close());
});

ui.editorDialog.addEventListener("close", () => { state.editing = null; });
ui.confirmDialog.addEventListener("close", () => { state.pendingDelete = null; });
document.querySelectorAll(".app-dialog").forEach((dialog) => {
  dialog.addEventListener("close", () => {
    document.body.classList.toggle("dialog-open", Boolean(document.querySelector(".app-dialog[open]")));
  });
});

document.querySelector("#date-today").addEventListener("click", () => setTaskDate(todayDate()));
document.querySelector("#date-tomorrow").addEventListener("click", () => setTaskDate(offsetDate(1)));
document.querySelector("#date-custom-button").addEventListener("click", () => {
  const date = document.querySelector("#task-due-date");
  date.classList.remove("is-hidden");
  date.focus();
  if (date.showPicker) date.showPicker();
});
document.querySelector("#task-due-date").addEventListener("change", (event) => {
  if (event.target.value) setTaskDate(event.target.value);
});
document.querySelector("#task-time-toggle").addEventListener("click", () => {
  const input = document.querySelector("#task-due-time");
  if (input.hidden) {
    input.hidden = false;
    input.classList.remove("is-hidden");
    document.querySelector("#task-time-toggle").setAttribute("aria-expanded", "true");
    input.focus();
    if (input.showPicker) input.showPicker();
  } else {
    input.focus();
    if (input.showPicker) input.showPicker();
  }
});
document.querySelector("#task-due-time").addEventListener("change", (event) => {
  setTaskTime(event.target.value);
});
document.querySelector("#task-time-clear").addEventListener("click", () => setTaskTime(""));
ui.main.addEventListener("submit", (event) => {
  if (event.target.id !== "custom-focus-form") return;
  event.preventDefault();
  const input = document.querySelector("#custom-focus-duration");
  const duration = Number(input.value);
  if (!input.value.trim() || !Number.isInteger(duration) || duration < 1 || duration > 720) {
    input.setCustomValidity("Enter a whole number between 1 and 720 minutes.");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  if (changeFocusDuration(duration)) input.value = "";
});
ui.main.addEventListener("input", (event) => {
  if (event.target.id === "custom-focus-duration") event.target.setCustomValidity("");
});

document.querySelector("#search-input").addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
  const search = document.querySelector("#search-input");
  if (search) search.focus();
});

document.querySelector("#clear-search").addEventListener("click", () => {
  if (state.query) {
    state.query = "";
    ui.searchInput.value = "";
    render();
    ui.searchInput.focus();
    return;
  }
  state.searchOpen = false;
  render();
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".popup-anchor")) closeMenus();
  if (state.quickAddOpen && !event.target.closest("#fab, #fab-actions")) closeQuickAdd();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeMenus();
    closeQuickAdd();
  }
});

ui.main.addEventListener("click", (event) => {
  const choice = event.target.closest("[data-duration]");
  if (choice) changeFocusDuration(Number(choice.dataset.duration));
});

window.addEventListener("popstate", (event) => {
  const page = event.state && event.state.taskkar ? event.state.page : "todo";
  state.page = Object.prototype.hasOwnProperty.call(PAGE_TITLES, page) ? page : "todo";
  state.quickAddOpen = false;
  state.searchOpen = false;
  state.query = "";
  ui.searchInput.value = "";
  closeMenus();
  render();
});

window.addEventListener("online", refreshConnectionBanner);
window.addEventListener("offline", refreshConnectionBanner);
document.addEventListener("visibilitychange", tickFocusTimer);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  document.querySelector("#install-button").hidden = false;
});
document.querySelector("#install-button").addEventListener("click", requestInstall);
window.addEventListener("appinstalled", () => {
  state.deferredInstallPrompt = null;
  document.querySelector("#install-button").hidden = true;
  showSnackbar("TaskKar added to your home screen");
});

render();
refreshConnectionBanner();
if (focusStorageWarning) showSnackbar(focusStorageWarning);
window.setInterval(tickFocusTimer, 500);
void refreshData().catch((error) => {
  ui.main.innerHTML = emptyState(
    "Your local storage isn't available",
    error.message || "Allow this site to use device storage, then reload to try again.",
    "Reload",
    "reload-app",
  );
});
ui.main.addEventListener("click", (event) => {
  if (event.target.closest("#reload-app")) window.location.reload();
});

if (!window.TaskKarAndroid && "serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./service-worker.js", { scope: "./" })
    .catch((error) => showSnackbar(`Offline support could not be set up: ${error.message}`));
}
