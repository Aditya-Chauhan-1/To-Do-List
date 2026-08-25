const STORAGE_KEY = "aurora-tasks";
const THEME_KEY = "aurora-theme";
const ACTIVITY_KEY = "aurora-activity";
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const CATEGORIES = ["personal", "work", "study", "shopping", "health"];
const VIEW_TITLES = {
    all: "All tasks",
    today: "Today",
    upcoming: "Upcoming",
    overdue: "Overdue",
    high: "High priority",
    pinned: "Pinned",
};
const FOCUS_SECONDS = 25 * 60;

const els = {
    form: document.getElementById("task-form"),
    input: document.getElementById("task-input"),
    priority: document.getElementById("task-priority"),
    category: document.getElementById("task-category"),
    date: document.getElementById("task-date"),
    repeat: document.getElementById("task-repeat"),
    list: document.getElementById("task-list"),
    empty: document.getElementById("empty-state"),
    search: document.getElementById("search-input"),
    sort: document.getElementById("sort-select"),
    toast: document.getElementById("toast"),
    toastMsg: document.getElementById("toast-msg"),
    toastAction: document.getElementById("toast-action"),
    greeting: document.getElementById("greeting"),
    today: document.getElementById("today-label"),
    themeBtn: document.getElementById("theme-toggle"),
    clearBtn: document.getElementById("clear-completed"),
    ringFill: document.getElementById("ring-fill"),
    progressPct: document.getElementById("progress-pct"),
    progressCopy: document.getElementById("progress-copy"),
    statTotal: document.getElementById("stat-total"),
    statActive: document.getElementById("stat-active"),
    statDone: document.getElementById("stat-done"),
    viewTitle: document.getElementById("view-title"),
    weekBars: document.getElementById("week-bars"),
    streak: document.getElementById("streak-label"),
    helpBtn: document.getElementById("help-btn"),
    helpModal: document.getElementById("help-modal"),
    helpClose: document.getElementById("help-close"),
    exportBtn: document.getElementById("export-btn"),
    importFile: document.getElementById("import-file"),
    focusBar: document.getElementById("focus-bar"),
    focusTitle: document.getElementById("focus-title"),
    focusTime: document.getElementById("focus-time"),
    focusPause: document.getElementById("focus-pause"),
    focusStop: document.getElementById("focus-stop"),
};

let tasks = loadTasks();
let activity = loadActivity();
let filter = "all";
let view = "all";
let editingId = null;
let expandedId = null;
let undoState = null;
let dragId = null;
let focusTimer = { taskId: null, remaining: FOCUS_SECONDS, running: false, interval: null };

init();

function init() {
    applyTheme(localStorage.getItem(THEME_KEY) || "dark");
    setHeader();
    els.date.min = todayISO();
    enhanceSelect(els.priority);
    enhanceSelect(els.category);
    enhanceSelect(els.repeat);
    enhanceSelect(els.sort);
    render();
    remindDueTasks();

    els.form.addEventListener("submit", onSubmit);
    els.form.addEventListener("reset", () => {
        requestAnimationFrame(() => {
            els.priority.value = "medium";
            els.repeat.value = "none";
            syncCustomSelects();
        });
    });
    els.search.addEventListener("input", render);
    els.sort.addEventListener("change", render);
    els.themeBtn.addEventListener("click", toggleTheme);
    els.clearBtn.addEventListener("click", clearCompleted);
    els.helpBtn.addEventListener("click", () => toggleHelp(true));
    els.helpClose.addEventListener("click", () => toggleHelp(false));
    els.helpModal.addEventListener("click", (e) => {
        if (e.target === els.helpModal) toggleHelp(false);
    });
    els.exportBtn.addEventListener("click", exportTasks);
    els.importFile.addEventListener("change", importTasks);
    els.toastAction.addEventListener("click", undoLast);
    els.focusPause.addEventListener("click", toggleFocusPause);
    els.focusStop.addEventListener("click", stopFocus);

    document.querySelectorAll(".filter").forEach((btn) => {
        btn.addEventListener("click", () => setFilter(btn.dataset.filter));
    });
    document.querySelectorAll(".view-btn").forEach((btn) => {
        btn.addEventListener("click", () => setView(btn.dataset.view));
    });

    els.list.addEventListener("click", onListClick);
    els.list.addEventListener("change", onListChange);
    els.list.addEventListener("dblclick", (e) => {
        if (e.target.closest("input, textarea, button, .details")) return;
        const item = e.target.closest(".task");
        if (item) startEdit(item.dataset.id);
    });

    els.list.addEventListener("dragstart", (e) => {
        const item = e.target.closest(".task");
        if (!item) return;
        dragId = item.dataset.id;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
    });
    els.list.addEventListener("dragend", () => {
        dragId = null;
        els.list.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
    });
    els.list.addEventListener("dragover", (e) => {
        e.preventDefault();
        const over = e.target.closest(".task");
        if (!over || over.dataset.id === dragId) return;
        const dragging = els.list.querySelector(".dragging");
        if (!dragging) return;
        const rect = over.getBoundingClientRect();
        const after = e.clientY > rect.top + rect.height / 2;
        over.parentNode.insertBefore(dragging, after ? over.nextSibling : over);
    });
    els.list.addEventListener("drop", (e) => {
        e.preventDefault();
        commitManualOrder();
    });

    els.list.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target.matches("[data-sub-input]")) {
            e.preventDefault();
            const item = e.target.closest(".task");
            addSubtask(item.dataset.id, item);
        }
    });

    document.addEventListener("keydown", onGlobalKeys);
}

function onSubmit(e) {
    e.preventDefault();
    const parsed = parseQuickAdd(els.input.value);
    if (!parsed.text) {
        showToast("Write a task first");
        els.input.focus();
        return;
    }

    tasks.unshift(normalizeTask({
        id: uid(),
        text: parsed.text,
        completed: false,
        priority: parsed.priority,
        category: parsed.category,
        dueDate: parsed.dueDate,
        repeat: parsed.repeat,
        createdAt: Date.now(),
        order: Date.now(),
    }));

    els.form.reset();
    els.priority.value = "medium";
    els.repeat.value = "none";
    syncCustomSelects();
    els.input.focus();
    persist();
    render();
    showToast("Task added");
}

function parseQuickAdd(raw) {
    let text = raw.trim();
    let priority = els.priority.value;
    let category = els.category.value;
    let dueDate = els.date.value || null;
    let repeat = els.repeat.value;

    const p = text.match(/!(high|medium|low)\b/i);
    if (p) {
        priority = p[1].toLowerCase();
        text = text.replace(p[0], "");
    }

    const tag = text.match(/#([a-z]+)/i);
    if (tag && CATEGORIES.includes(tag[1].toLowerCase())) {
        category = tag[1].toLowerCase();
        text = text.replace(tag[0], "");
    }

    if (/\bevery\s*day\b|\bdaily\b/i.test(text)) {
        repeat = "daily";
        text = text.replace(/\bevery\s*day\b|\bdaily\b/gi, "");
    } else if (/\bevery\s*week\b|\bweekly\b/i.test(text)) {
        repeat = "weekly";
        text = text.replace(/\bevery\s*week\b|\bweekly\b/gi, "");
    }

    if (/\btomorrow\b/i.test(text)) {
        dueDate = addDays(1);
        text = text.replace(/\btomorrow\b/gi, "");
    } else if (/\btoday\b/i.test(text)) {
        dueDate = todayISO();
        text = text.replace(/\btoday\b/gi, "");
    } else if (/\bnext week\b/i.test(text)) {
        dueDate = addDays(7);
        text = text.replace(/\bnext week\b/gi, "");
    } else {
        const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
        const dayMatch = text.match(new RegExp(`\\b(${days.join("|")})\\b`, "i"));
        if (dayMatch) {
            dueDate = nextWeekday(days.indexOf(dayMatch[1].toLowerCase()));
            text = text.replace(dayMatch[0], "");
        }
    }

    return {
        text: text.replace(/\s+/g, " ").trim(),
        priority,
        category,
        dueDate,
        repeat,
    };
}

function onListClick(e) {
    const item = e.target.closest(".task");
    if (!item) return;
    const id = item.dataset.id;
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;

    if (action === "toggle") toggleTask(id);
    else if (action === "edit") startEdit(id);
    else if (action === "save") saveEdit(id);
    else if (action === "delete") deleteTask(id);
    else if (action === "pin") pinTask(id);
    else if (action === "expand") toggleExpand(id);
    else if (action === "focus") startFocus(id);
    else if (action === "add-sub") addSubtask(id, item);
    else if (action === "delete-sub") deleteSubtask(id, e.target.closest("[data-sub-id]").dataset.subId);
}

function onListChange(e) {
    const item = e.target.closest(".task");
    if (!item) return;
    const task = tasks.find((t) => t.id === item.dataset.id);
    if (!task) return;

    if (e.target.dataset.field === "notes") {
        task.notes = e.target.value;
        persist();
        return;
    }
    if (e.target.dataset.field === "repeat") {
        task.repeat = e.target.value;
        persist();
        render();
        return;
    }
    if (e.target.dataset.field === "sub") {
        const sub = task.subtasks.find((s) => s.id === e.target.closest("[data-sub-id]").dataset.subId);
        if (sub) sub.done = e.target.checked;
        persist();
        render();
    }
}

function toggleTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.completed = !task.completed;
    task.completedAt = task.completed ? Date.now() : null;
    if (task.completed) {
        logActivity();
        if (task.repeat && task.repeat !== "none") spawnRepeat(task);
    }
    persist();
    render();
    if (task.completed && tasks.filter((t) => !t.completed).length === 0 && tasks.length) {
        showToast("All tasks complete — nice work");
    }
}

function spawnRepeat(task) {
    const nextDue = task.dueDate
        ? addDays(task.repeat === "weekly" ? 7 : 1, task.dueDate)
        : addDays(task.repeat === "weekly" ? 7 : 1);
    tasks.unshift(normalizeTask({
        ...task,
        id: uid(),
        completed: false,
        completedAt: null,
        dueDate: nextDue,
        createdAt: Date.now(),
        order: Date.now(),
        subtasks: (task.subtasks || []).map((s) => ({ ...s, id: uid(), done: false })),
    }));
}

function deleteTask(id) {
    const index = tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    undoState = { task: tasks[index], index };
    tasks.splice(index, 1);
    if (expandedId === id) expandedId = null;
    persist();
    render();
    showToast("Task removed", { label: "Undo", onClick: undoLast });
}

function undoLast() {
    if (!undoState) return;
    tasks.splice(undoState.index, 0, undoState.task);
    undoState = null;
    persist();
    render();
    showToast("Task restored");
}

function pinTask(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.pinned = !task.pinned;
    persist();
    render();
}

function toggleExpand(id) {
    expandedId = expandedId === id ? null : id;
    editingId = null;
    render();
    const notes = els.list.querySelector(".notes");
    if (notes) notes.focus();
}

function addSubtask(id, item) {
    const input = item.querySelector("[data-sub-input]");
    const text = input?.value.trim();
    if (!text) return;
    const task = tasks.find((t) => t.id === id);
    task.subtasks.push({ id: uid(), text, done: false });
    persist();
    render();
}

function deleteSubtask(id, subId) {
    const task = tasks.find((t) => t.id === id);
    task.subtasks = task.subtasks.filter((s) => s.id !== subId);
    persist();
    render();
}

function startEdit(id) {
    editingId = id;
    render();
    const input = els.list.querySelector(".edit-input");
    if (!input) return;
    input.focus();
    input.select();
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") saveEdit(id);
        if (e.key === "Escape") {
            editingId = null;
            render();
        }
    });
}

function saveEdit(id) {
    const input = els.list.querySelector(".edit-input");
    const text = input?.value.trim();
    const task = tasks.find((t) => t.id === id);
    if (task && text) task.text = text;
    editingId = null;
    persist();
    render();
}

function clearCompleted() {
    const removed = tasks.filter((t) => t.completed);
    if (!removed.length) {
        showToast("No completed tasks");
        return;
    }
    tasks = tasks.filter((t) => !t.completed);
    persist();
    render();
    showToast(`Cleared ${removed.length} completed`);
}

function setFilter(next) {
    filter = next;
    document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b.dataset.filter === next));
    render();
}

function setView(next) {
    view = next;
    document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === next));
    els.viewTitle.textContent = VIEW_TITLES[next];
    render();
}

function visibleTasks() {
    const query = els.search.value.trim().toLowerCase();
    const today = todayISO();
    const filtered = tasks.filter((task) => {
        const matchesStatus =
            filter === "all" ||
            (filter === "active" && !task.completed) ||
            (filter === "completed" && task.completed);
        const hay = `${task.text} ${task.category} ${task.notes || ""}`.toLowerCase();
        const matchesQuery = hay.includes(query);
        const matchesView =
            view === "all" ||
            (view === "today" && task.dueDate === today && !task.completed) ||
            (view === "upcoming" && task.dueDate && task.dueDate > today && !task.completed) ||
            (view === "overdue" && isOverdue(task)) ||
            (view === "high" && task.priority === "high" && !task.completed) ||
            (view === "pinned" && task.pinned);
        return matchesStatus && matchesQuery && matchesView;
    });

    const sort = els.sort.value;
    return filtered.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sort === "priority") return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (sort === "due") return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
        if (sort === "alpha") return a.text.localeCompare(b.text);
        if (sort === "created") return b.createdAt - a.createdAt;
        return (a.order || 0) - (b.order || 0);
    });
}

function commitManualOrder() {
    const ids = [...els.list.querySelectorAll(".task")].map((el) => el.dataset.id);
    ids.forEach((id, index) => {
        const task = tasks.find((t) => t.id === id);
        if (task) task.order = index;
    });
    els.sort.value = "manual";
    syncCustomSelects();
    persist();
}

function render() {
    flushOpenEditor();
    const visible = visibleTasks();
    els.list.innerHTML = visible.map(taskTemplate).join("");
    els.empty.hidden = visible.length !== 0;

    if (!tasks.length) {
        els.empty.querySelector("h3").textContent = "No tasks yet";
        els.empty.querySelector("p").textContent = "Try: Finish slides tomorrow !high #work";
    } else if (!visible.length) {
        els.empty.querySelector("h3").textContent = "Nothing in this view";
        els.empty.querySelector("p").textContent = "Switch lists or add a matching task.";
    }

    updateStats();
    updateSidebarCounts();
    renderWeek();
}

function taskTemplate(task) {
    const overdue = isOverdue(task);
    const dueLabel = task.dueDate ? formatDue(task.dueDate, overdue) : "No date";
    const doneSubs = (task.subtasks || []).filter((s) => s.done).length;
    const body = editingId === task.id
        ? `<input class="edit-input" value="${escapeAttr(task.text)}" maxlength="180">`
        : `<h3>${escapeHtml(task.text)}</h3>`;
    const expanded = expandedId === task.id;

    return `
        <li class="task ${task.completed ? "done" : ""} ${task.pinned ? "pinned" : ""} ${editingId === task.id ? "editing" : ""}" data-id="${task.id}" draggable="true">
            <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
            <button type="button" class="check" data-action="toggle" aria-label="Toggle complete">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
            </button>
            <div class="task-body">
                ${body}
                <div class="task-meta">
                    <span class="pill ${task.priority}">${task.priority}</span>
                    <span class="pill cat">${task.category}</span>
                    <span class="pill ${overdue ? "overdue" : "due"}">${dueLabel}</span>
                    ${task.repeat && task.repeat !== "none" ? `<span class="pill repeat">${task.repeat}</span>` : ""}
                    ${task.subtasks.length ? `<span class="pill sub">${doneSubs}/${task.subtasks.length} sub</span>` : ""}
                </div>
                ${expanded ? detailsTemplate(task) : ""}
            </div>
            <div class="task-actions">
                <button type="button" class="pin-btn" data-action="pin" title="Pin">${task.pinned ? "★" : "☆"}</button>
                <button type="button" data-action="expand" title="Details">${expanded ? "▴" : "▾"}</button>
                <button type="button" data-action="focus" title="25-min focus">▶</button>
                <button type="button" class="delete" data-action="delete" aria-label="Delete task">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                </button>
            </div>
        </li>
    `;
}

function detailsTemplate(task) {
    const subs = task.subtasks.map((sub) => `
        <li class="subtask ${sub.done ? "done" : ""}" data-sub-id="${sub.id}">
            <input type="checkbox" data-field="sub" ${sub.done ? "checked" : ""}>
            <span>${escapeHtml(sub.text)}</span>
            <button type="button" data-action="delete-sub" aria-label="Remove subtask">×</button>
        </li>
    `).join("");

    return `
        <div class="details">
            <ul class="subtasks">${subs}</ul>
            <div class="sub-row" style="display:flex;gap:8px;align-items:center;padding:0;border:none;background:transparent;">
                <input data-sub-input maxlength="80" placeholder="Add a subtask" class="sub-row">
                <button type="button" class="ghost-btn" data-action="add-sub">Add</button>
            </div>
            <textarea class="notes" data-field="notes" placeholder="Notes, links, context...">${escapeHtml(task.notes || "")}</textarea>
            <div class="details-row">
                <select data-field="repeat">
                    <option value="none" ${task.repeat === "none" ? "selected" : ""}>Does not repeat</option>
                    <option value="daily" ${task.repeat === "daily" ? "selected" : ""}>Daily</option>
                    <option value="weekly" ${task.repeat === "weekly" ? "selected" : ""}>Weekly</option>
                </select>
            </div>
        </div>
    `;
}

function flushOpenEditor() {
    const notes = els.list.querySelector(".notes");
    if (!notes || !expandedId) return;
    const task = tasks.find((t) => t.id === expandedId);
    if (task) task.notes = notes.value;
}

function updateStats() {
    const total = tasks.length;
    const done = tasks.filter((t) => t.completed).length;
    const active = total - done;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const ring = 97.4;

    els.statTotal.textContent = total;
    els.statActive.textContent = active;
    els.statDone.textContent = done;
    els.progressPct.textContent = `${pct}%`;
    els.ringFill.style.strokeDashoffset = String(ring - (ring * pct) / 100);
    els.progressCopy.textContent = total ? `${done} of ${total} complete` : "Start by adding a task";
}

function updateSidebarCounts() {
    const today = todayISO();
    const open = tasks.filter((t) => !t.completed);
    setCount("count-all", tasks.length);
    setCount("count-today", open.filter((t) => t.dueDate === today).length);
    setCount("count-upcoming", open.filter((t) => t.dueDate && t.dueDate > today).length);
    setCount("count-overdue", tasks.filter(isOverdue).length);
    setCount("count-high", open.filter((t) => t.priority === "high").length);
    setCount("count-pinned", tasks.filter((t) => t.pinned).length);
}

function setCount(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function renderWeek() {
    const days = [...Array(7)].map((_, i) => addDays(i - 6));
    els.weekBars.innerHTML = days.map((day) => {
        const count = activity[day] || 0;
        const height = Math.max(8, Math.min(52, 8 + count * 10));
        return `<i class="${count ? "on" : ""}" style="height:${height}px" title="${day}: ${count}"></i>`;
    }).join("");

    const streak = getStreak();
    els.streak.textContent = `${streak} day streak`;
}

function logActivity() {
    const day = todayISO();
    activity[day] = (activity[day] || 0) + 1;
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
}

function getStreak() {
    let streak = 0;
    let cursor = todayISO();
    if (!activity[cursor]) cursor = addDays(-1);
    while (activity[cursor]) {
        streak += 1;
        cursor = addDays(-1, cursor);
    }
    return streak;
}

function startFocus(id) {
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    stopFocus();
    focusTimer = { taskId: id, remaining: FOCUS_SECONDS, running: true, interval: null };
    els.focusTitle.textContent = task.text;
    els.focusBar.hidden = false;
    els.focusPause.textContent = "Pause";
    tickFocus();
    focusTimer.interval = setInterval(tickFocus, 1000);
    if (Notification.permission === "default") Notification.requestPermission();
}

function tickFocus() {
    const mins = String(Math.floor(focusTimer.remaining / 60)).padStart(2, "0");
    const secs = String(focusTimer.remaining % 60).padStart(2, "0");
    els.focusTime.textContent = `${mins}:${secs}`;
    if (focusTimer.remaining <= 0) {
        const task = tasks.find((t) => t.id === focusTimer.taskId);
        stopFocus();
        showToast("Focus session complete");
        notify("Focus complete", task ? task.text : "Session finished");
        return;
    }
    if (focusTimer.running) focusTimer.remaining -= 1;
}

function toggleFocusPause() {
    if (!focusTimer.taskId) return;
    focusTimer.running = !focusTimer.running;
    els.focusPause.textContent = focusTimer.running ? "Pause" : "Resume";
}

function stopFocus() {
    clearInterval(focusTimer.interval);
    focusTimer = { taskId: null, remaining: FOCUS_SECONDS, running: false, interval: null };
    els.focusBar.hidden = true;
}

function remindDueTasks() {
    const due = tasks.filter((t) => !t.completed && (isOverdue(t) || t.dueDate === todayISO()));
    if (!due.length) return;
    showToast(`${due.length} task${due.length > 1 ? "s" : ""} due today`);
    if (Notification.permission === "granted") {
        notify("Aurora", `${due.length} task${due.length > 1 ? "s" : ""} need your attention`);
    }
}

function notify(title, body) {
    if (Notification.permission !== "granted") return;
    try { new Notification(title, { body }); } catch {}
}

function exportTasks() {
    const blob = new Blob([JSON.stringify({ tasks, activity }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "aurora-tasks.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported tasks");
}

function importTasks(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            const incoming = Array.isArray(data) ? data : data.tasks;
            if (!Array.isArray(incoming)) throw new Error("Invalid file");
            tasks = incoming.map(normalizeTask);
            if (data.activity) activity = data.activity;
            persist();
            localStorage.setItem(ACTIVITY_KEY, JSON.stringify(activity));
            render();
            showToast("Imported tasks");
        } catch {
            showToast("Could not import that file");
        }
        e.target.value = "";
    };
    reader.readAsText(file);
}

function onGlobalKeys(e) {
    if (e.key === "Escape") {
        toggleHelp(false);
        closeAllSelects();
        if (editingId) {
            editingId = null;
            render();
        }
        return;
    }
    if (isTyping(e)) return;
    if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        els.input.focus();
    } else if (e.key === "/") {
        e.preventDefault();
        els.search.focus();
    } else if (e.key === "?") {
        e.preventDefault();
        toggleHelp(els.helpModal.hidden);
    } else if (e.key === "1") setFilter("all");
    else if (e.key === "2") setFilter("active");
    else if (e.key === "3") setFilter("completed");
}

function isTyping(e) {
    const t = e.target;
    return t.matches("input, textarea, select") || t.isContentEditable;
}

function toggleHelp(show) {
    els.helpModal.hidden = !show;
}

function setHeader() {
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    els.greeting.textContent = `${greet} — stay in flow`;
    els.today.textContent = new Intl.DateTimeFormat("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "short",
    }).format(new Date());
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
}

function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
}

function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function loadTasks() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(saved) ? saved.map(normalizeTask) : [];
    } catch {
        return [];
    }
}

function loadActivity() {
    try {
        return JSON.parse(localStorage.getItem(ACTIVITY_KEY) || "{}") || {};
    } catch {
        return {};
    }
}

function normalizeTask(task) {
    return {
        id: task.id || uid(),
        text: task.text || "",
        completed: Boolean(task.completed),
        priority: PRIORITY_RANK[task.priority] != null ? task.priority : "medium",
        category: CATEGORIES.includes(task.category) ? task.category : "personal",
        dueDate: task.dueDate || null,
        createdAt: task.createdAt || Date.now(),
        order: task.order ?? task.createdAt ?? Date.now(),
        pinned: Boolean(task.pinned),
        notes: task.notes || "",
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        repeat: task.repeat || "none",
        completedAt: task.completedAt || null,
    };
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function addDays(amount, from = todayISO()) {
    const date = new Date(`${from}T00:00:00`);
    date.setDate(date.getDate() + amount);
    return date.toISOString().slice(0, 10);
}

function nextWeekday(target) {
    const now = new Date();
    const delta = (target - now.getDay() + 7) % 7 || 7;
    return addDays(delta);
}

function isOverdue(task) {
    return Boolean(task.dueDate && !task.completed && task.dueDate < todayISO());
}

function formatDue(iso, overdue) {
    const date = new Date(`${iso}T00:00:00`);
    const label = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
    if (iso === todayISO()) return "Today";
    if (iso === addDays(1)) return "Tomorrow";
    return overdue ? `Overdue · ${label}` : label;
}

function showToast(message, action) {
    els.toastMsg.textContent = message;
    els.toastAction.hidden = !action;
    els.toastAction.textContent = action?.label || "Undo";
    els.toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
        els.toast.classList.remove("show");
        if (!action) undoState = undoState;
    }, action ? 4000 : 1800);
}

function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
    return escapeHtml(value).replaceAll('"', "&quot;");
}

function enhanceSelect(select) {
    if (!select || select.dataset.enhanced) return;

    const wrap = document.createElement("div");
    wrap.className = "custom-select";
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-label", select.getAttribute("aria-label") || select.id);

    const menu = document.createElement("ul");
    menu.className = "custom-menu";
    menu.setAttribute("role", "listbox");

    [...select.options].forEach((option) => {
        const item = document.createElement("li");
        item.dataset.value = option.value;
        item.textContent = option.textContent;
        item.setAttribute("role", "option");
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            select.value = option.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            syncCustomSelect(wrap);
            closeAllSelects();
        });
        menu.appendChild(item);
    });

    wrap.append(trigger, menu);
    select.dataset.enhanced = "true";
    syncCustomSelect(wrap);

    trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const alreadyOpen = wrap.classList.contains("open");
        closeAllSelects();
        if (!alreadyOpen) wrap.classList.add("open");
    });
}

function syncCustomSelect(wrap) {
    const select = wrap.querySelector("select");
    const trigger = wrap.querySelector(".custom-trigger");
    const selected = select.options[select.selectedIndex];
    trigger.textContent = selected ? selected.textContent : "";
    wrap.querySelectorAll(".custom-menu li").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.value === select.value);
    });
}

function syncCustomSelects() {
    document.querySelectorAll(".custom-select").forEach(syncCustomSelect);
}

function closeAllSelects() {
    document.querySelectorAll(".custom-select.open").forEach((wrap) => wrap.classList.remove("open"));
}

document.addEventListener("click", closeAllSelects);
