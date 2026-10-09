// The session rules are shared by the extension worker and the standalone dashboard.
// This file changes plain data; it never touches HTML or writes to storage.
(() => {
  if (globalThis.LockInBuddySession) return;

  const STORAGE_KEY = 'lock-in-buddy-session-v1';
  const UI_PREFIX = 'lock-in-buddy-ui-v1:';
  const DURATIONS = [5 * 60, 10 * 60, 25 * 60];
  const MAX_MESSAGES = 100;
  const cleanText = (value) => typeof value === 'string' ? value.trim().slice(0, 500) : '';

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
      messages: [{ id: 'welcome', sender: 'buddy', text: 'Let’s lock in! Tell me what you’re working on, or set your task above.' }],
    };
  }

  // Saved data can be missing or from an older version. Restore only known fields.
  function normalize(saved) {
    const state = create();
    if (!saved || saved.version !== 1) return state;
    state.revision = Number.isSafeInteger(saved.revision) && saved.revision >= 0 ? saved.revision : 0;
    state.task = cleanText(saved.task);
    state.step = cleanText(saved.step);
    state.taskDone = saved.taskDone === true;
    if (DURATIONS.includes(saved.duration)) state.duration = saved.duration;
    state.remaining = Number.isFinite(saved.remaining)
      ? Math.max(0, Math.min(state.duration, Math.ceil(saved.remaining))) : state.duration;
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
    return state;
  }

  function secondsLeft(state, now = Date.now()) {
    return state.status === 'running'
      ? Math.max(0, Math.ceil((state.endTime - now) / 1000)) : state.remaining;
  }

  // A command describes an intention ("pause"), rather than replacing an entire
  // state snapshot. That keeps an old tab from overwriting a newer tab's changes.
  function reduce(saved, action, now = Date.now()) {
    const state = normalize(saved);
    let changed = false;

    function message(text, sender = 'buddy') {
      const id = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
      state.messages.push({ id, sender, text });
      state.messages = state.messages.slice(-MAX_MESSAGES);
      changed = true;
    }

    function reset() {
      state.status = 'idle';
      state.endTime = null;
      state.remaining = state.duration;
      state.taskDone = false;
      changed = true;
    }

    function pause() {
      if (state.status !== 'running') return;
      state.remaining = secondsLeft(state, now);
      state.endTime = null;
      state.status = 'paused';
      changed = true;
    }

    function start() {
      if (!state.task) throw new Error('Set a task first, so Buddy knows what you’re focusing on.');
      if (state.status === 'running') return;
      const resuming = state.status === 'paused' && state.remaining > 0;
      if (!resuming) state.remaining = state.duration;
      state.status = 'running';
      state.taskDone = false;
      state.endTime = now + state.remaining * 1000;
      message(resuming ? `Back to “${state.step || state.task}”. One thing at a time!`
        : `Let’s focus on “${state.step || state.task}” for ${state.duration / 60} minutes. I’ll check in when time is up.`);
    }

    // Only a running timer can complete. Every tab may request this check, but
    // after the first completion the saved status prevents duplicate check-ins.
    if (state.status === 'running' && secondsLeft(state, now) === 0) {
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
          state.task = task;
          state.step = step;
          reset();
          message(`Your task is “${task}”. ${step ? `First small step: “${step}”.` : 'You can add a small first step above.'} Choose a focus time, then start when you’re ready.`);
        }
        break;
      }
      case 'setDuration':
        if (!DURATIONS.includes(action.duration)) throw new Error('Choose 5, 10, or 25 minutes.');
        if (state.status === 'running') throw new Error('Pause the timer before changing its duration.');
        state.duration = action.duration;
        reset();
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

  globalThis.LockInBuddySession = { STORAGE_KEY, UI_PREFIX, create, normalize, normalizeUI, reduce, secondsLeft };
})();
