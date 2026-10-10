// The session rules are shared by the extension worker, Buddy, and dashboard.
// This file changes plain data; it never touches HTML or writes to storage.
(() => {
  if (globalThis.LockInBuddySession) return;

  const STORAGE_KEY = 'lock-in-buddy-session-v1';
  const UI_PREFIX = 'lock-in-buddy-ui-v1:';
  const DURATIONS = [5 * 60, 10 * 60, 25 * 60];
  const MAX_MESSAGES = 100;
  const cleanText = (value) => typeof value === 'string' ? value.trim().slice(0, 500) : '';
  const makeId = (now) => globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;

  // Intervals let today's total exclude pauses and split time across midnight.
  function normalizeSegments(saved, limit) {
    if (!Array.isArray(saved)) return [];
    let left = limit;
    let lastEnd = 0;
    const segments = [];
    for (const segment of saved) {
      if (!Number.isFinite(segment?.start) || !Number.isFinite(segment?.end)) continue;
      const start = Math.max(0, lastEnd, segment.start);
      const end = Math.min(segment.end, start + left);
      if (end <= start) continue;
      segments.push({ start, end });
      left -= end - start;
      lastEnd = end;
    }
    return segments;
  }

  const elapsed = (segments) => segments.reduce((total, segment) => total + segment.end - segment.start, 0);

  function normalizeHistory(saved) {
    if (!Array.isArray(saved)) return [];
    const ids = new Set();
    return saved.flatMap((record) => {
      if (!record || typeof record.id !== 'string' || !record.id || ids.has(record.id)
        || !cleanText(record.task) || !DURATIONS.includes(record.plannedDuration)
        || !Number.isFinite(record.startedAt) || record.startedAt < 0
        || !Number.isFinite(record.endedAt) || record.endedAt < record.startedAt
        || !['completed', 'reset'].includes(record.outcome)) return [];
      const segments = normalizeSegments(record.segments, record.plannedDuration * 1000)
        .map(({ start, end }) => ({ start: Math.max(start, record.startedAt), end: Math.min(end, record.endedAt) }))
        .filter(({ start, end }) => end > start);
      if (!segments.length) return [];
      ids.add(record.id);
      return [{ id: record.id, task: cleanText(record.task), startedAt: record.startedAt,
        endedAt: record.endedAt, plannedDuration: record.plannedDuration,
        focusedMs: elapsed(segments), outcome: record.outcome,
        reason: ['timer', 'done', 'reset', 'taskChanged', 'durationChanged'].includes(record.reason) ? record.reason : record.outcome,
        segments }];
    });
  }

  function create() {
    return {
      version: 1,
      revision: 0,
      task: '',
      step: '',
      taskDone: false,
      duration: 25 * 60,
      remaining: 25 * 60,
      status: 'idle',
      endTime: null,
      active: null,
      history: [],
      messages: [{ id: 'welcome', sender: 'buddy', text: 'Let’s lock in! Tell me what you’re working on, or set your task above.' }],
    };
  }

  // Saved data can be missing or from an older version. Restore only known fields.
  function normalize(saved, now = Date.now()) {
    const state = create();
    if (!saved || saved.version !== 1) return state;
    state.revision = Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0;
    state.task = cleanText(saved.task);
    state.step = cleanText(saved.step);
    state.taskDone = saved.taskDone === true;
    if (DURATIONS.includes(saved.duration)) state.duration = saved.duration;
    state.remaining = Number.isFinite(saved.remaining)
      ? Math.max(0, Math.min(state.duration, saved.remaining)) : state.duration;
    if (['idle', 'running', 'paused', 'completed'].includes(saved.status)) state.status = saved.status;
    if (state.status === 'running') {
      if (Number.isFinite(saved.endTime) && saved.endTime > 0 && state.task) state.endTime = saved.endTime;
      else state.status = 'idle';
    }
    if (Array.isArray(saved.messages)) {
      const messages = saved.messages.filter((message) => message && typeof message.id === 'string'
        && ['user', 'buddy'].includes(message.sender) && typeof message.text === 'string')
        .slice(-MAX_MESSAGES)
        .map((message) => ({ id: message.id, sender: message.sender, text: message.text.slice(0, 1500) }));
      if (messages.length) state.messages = messages;
    }
    state.history = normalizeHistory(saved.history);
    if (['running', 'paused'].includes(state.status)) {
      const active = saved.active;
      if (active && typeof active.id === 'string' && active.id
        && Number.isFinite(active.startedAt) && active.startedAt >= 0
        && (state.status !== 'running' || (Number.isFinite(active.runStartedAt)
          && active.runStartedAt >= active.startedAt && active.runStartedAt <= state.endTime))) {
        const segments = normalizeSegments(active.segments, state.duration * 1000);
        state.active = { id: active.id, startedAt: active.startedAt, segments,
          runStartedAt: state.status === 'running' ? active.runStartedAt : null };
      } else {
        // Pre-history timers have no reliable pause timeline. Preserve their
        // remaining countdown, but only record time measured after this upgrade.
        const startedAt = state.status === 'running' ? Math.max(0, Math.min(now, state.endTime)) : now;
        state.active = { id: `legacy-${state.revision}-${startedAt}`, startedAt,
          segments: [], runStartedAt: state.status === 'running' ? startedAt : null };
      }
    }
    return state;
  }

  function secondsLeft(state, now = Date.now()) {
    return state.status === 'running'
      ? Math.max(0, Math.ceil((state.endTime - now) / 1000)) : Math.ceil(state.remaining);
  }

  // A command describes an intention ("pause"), rather than replacing an entire
  // state snapshot. That keeps an old tab from overwriting a newer tab's changes.
  function reduce(saved, action, now = Date.now()) {
    const state = normalize(saved, now);
    let changed = false;

    function message(text, sender = 'buddy') {
      const id = makeId(now);
      state.messages.push({ id, sender, text });
      state.messages = state.messages.slice(-MAX_MESSAGES);
      changed = true;
    }

    function accrue(at) {
      if (!state.active || state.status !== 'running') return;
      const start = state.active.runStartedAt;
      const end = Math.min(at, state.endTime, start + state.duration * 1000 - elapsed(state.active.segments));
      if (end > start) state.active.segments.push({ start, end });
      state.active.runStartedAt = null;
    }

    function finish(outcome, reason, at = now) {
      if (!state.active) return;
      accrue(at);
      const active = state.active;
      const focusedMs = elapsed(active.segments);
      if (focusedMs > 0 && !state.history.some((record) => record.id === active.id)) {
        state.history.push({ id: active.id, task: state.task, startedAt: active.startedAt,
          endedAt: Math.max(active.startedAt, at), plannedDuration: state.duration,
          focusedMs, outcome, reason, segments: active.segments });
      }
      state.active = null;
      changed = true;
    }

    function reset(reason = 'reset') {
      finish('reset', reason);
      state.status = 'idle';
      state.endTime = null;
      state.remaining = state.duration;
      state.taskDone = false;
      changed = true;
    }

    function pause() {
      if (state.status !== 'running') return;
      accrue(now);
      state.remaining = Math.max(0, Math.min(state.duration, (state.endTime - now) / 1000));
      state.endTime = null;
      state.status = 'paused';
      changed = true;
    }

    function start() {
      if (!state.task) throw new Error('Set a task first, so Buddy knows what you’re focusing on.');
      if (state.status === 'running') return;
      const resuming = state.status === 'paused' && state.remaining > 0;
      if (!resuming) {
        state.remaining = state.duration;
        state.active = { id: makeId(now), startedAt: now, segments: [], runStartedAt: now };
      } else state.active.runStartedAt = now;
      state.status = 'running';
      state.taskDone = false;
      state.endTime = now + state.remaining * 1000;
      message(resuming ? `Back to “${state.step || state.task}”. One thing at a time!`
        : `Let’s focus on “${state.step || state.task}” for ${state.duration / 60} minutes. I’ll check in when time is up.`);
    }

    // Only a running timer can complete. Every tab may request this check, but
    // after the first completion the saved status prevents duplicate check-ins.
    if (state.status === 'running' && secondsLeft(state, now) === 0) {
      finish('completed', 'timer', state.endTime);
      state.status = 'completed';
      state.endTime = null;
      state.remaining = 0;
      message(`Focus time is up for “${state.step || state.task}”! How did it go? Reply “done”, “more time”, or “break”.`);
    }

    switch (action?.type) {
      case 'reconcile':
        break;
      case 'setTask': {
        const task = cleanText(action.task);
        const step = cleanText(action.step);
        if (!task) throw new Error('Give your task a name first.');
        if (task !== state.task || step !== state.step || state.taskDone) {
          reset('taskChanged');
          state.task = task;
          state.step = step;
          message(`Your task is “${task}”. ${step ? `First small step: “${step}”.` : 'You can add a small first step above.'} Choose a focus time, then start when you’re ready.`);
        }
        break;
      }
      case 'setDuration':
        if (!DURATIONS.includes(action.duration)) throw new Error('Choose 5, 10, or 25 minutes.');
        if (state.status === 'running') throw new Error('Pause the timer before changing its duration.');
        reset('durationChanged');
        state.duration = action.duration;
        state.remaining = state.duration;
        break;
      case 'start':
        start();
        break;
      case 'pause':
        pause();
        break;
      case 'reset':
        reset();
        break;
      case 'chat': {
        const text = cleanText(action.text);
        if (!text) break;
        message(text, 'user');
        // Deliberately simple, explicit commands. “Not done” does not finish a task.
        const command = text.toLowerCase().replace(/[.!?]+$/, '').trim();
        if (/^(hi|hello|hey)$/.test(command)) {
          message(state.task ? `Hey! How is “${state.task}” going?` : 'Hey! What would you like to work on?');
        } else if (/^(done|finished|i’m done|i'm done|i am done)$/.test(command)) {
          if (!state.task) message('Set a task first, then we can celebrate finishing it.');
          else {
            finish('completed', 'done');
            state.taskDone = true;
            state.status = 'completed';
            state.endTime = null;
            state.remaining = 0;
            message(`You finished “${state.task}”! Take a breather, or set your next task above.`);
          }
        } else if (/^(more time|start|resume)$/.test(command) && state.task) {
          const alreadyRunning = state.status === 'running';
          start();
          if (alreadyRunning) message('Your focus timer is already running. Keep going, one small step at a time.');
        } else if (/\b(tired|break|rest)\b/.test(command)) {
          pause();
          message('Take a breather. Any running focus timer is now paused; resume when you’re ready.');
        } else if (!state.task) {
          state.task = text;
          reset();
          message(`Got it: “${state.task}”. Add a small first step above if you like, then start your focus timer below.`);
        } else if (state.status === 'completed') {
          message('How did your focus time go? Reply “done”, “more time”, or “break”, or set your next task above.');
        } else {
          message(`Keep it small: ${state.step ? `work on “${state.step}”` : `pick one step toward “${state.task}”`}. ${state.status === 'running' ? 'Your timer is running.' : 'Start or resume your focus timer when you’re ready.'}`);
        }
        break;
      }
      default:
        throw new Error('Unknown Buddy command.');
    }

    if (changed) state.revision += 1;
    return state;
  }

  function normalizeUI(saved) {
    const ui = { position: null, panelOpen: false, tab: 'chat' };
    if (!saved || typeof saved !== 'object') return ui;
    if (Number.isFinite(saved.position?.left) && Number.isFinite(saved.position?.top)) {
      ui.position = { left: Math.max(0, saved.position.left), top: Math.max(0, saved.position.top) };
    }
    ui.panelOpen = saved.panelOpen === true;
    ui.tab = saved.tab === 'timer' ? 'timer' : 'chat';
    return ui;
  }

  function statistics(saved, now = Date.now()) {
    const state = normalize(saved, now);
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    let todayMs = 0;
    let totalMs = 0;
    const segments = state.history.flatMap((record) => record.segments);
    if (state.active) {
      segments.push(...state.active.segments);
      if (state.status === 'running') {
        const start = state.active.runStartedAt;
        const end = Math.min(now, state.endTime, start + state.duration * 1000 - elapsed(state.active.segments));
        if (end > start) segments.push({ start, end });
      }
    }
    for (const { start, end } of segments) {
      totalMs += end - start;
      todayMs += Math.max(0, Math.min(end, now) - Math.max(start, midnight.getTime()));
    }
    const completed = state.history.filter((record) => record.outcome === 'completed');
    return { todayMs, totalMs, completedSessions: completed.length,
      averageMs: completed.length ? completed.reduce((sum, record) => sum + record.focusedMs, 0) / completed.length : 0 };
  }

  globalThis.LockInBuddySession = { STORAGE_KEY, UI_PREFIX, create, normalize, normalizeUI, reduce, secondsLeft, statistics };
})();
