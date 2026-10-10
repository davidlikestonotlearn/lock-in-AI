// Chrome can stop this worker whenever it is idle. Storage, not these variables,
// is the source of truth. The queue only serializes overlapping commands while awake.
importScripts('session.js');

const Session = globalThis.LockInBuddySession;
const ALARM_NAME = 'lock-in-buddy-focus-complete';
let queue = Promise.resolve();

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }).catch(console.error);
});

function enqueue(work) {
  const result = queue.then(work);
  queue = result.catch(() => {}); // A failed command must not block later commands.
  return result;
}

async function schedule(state) {
  if (state.status === 'running') {
    const alarm = await chrome.alarms.get(ALARM_NAME);
    if (!alarm || alarm.scheduledTime !== state.endTime) {
      await chrome.alarms.create(ALARM_NAME, { when: state.endTime });
    }
  } else {
    await chrome.alarms.clear(ALARM_NAME);
  }
}

async function updateSession(action) {
  const stored = await chrome.storage.local.get(Session.STORAGE_KEY);
  const previous = Session.normalize(stored[Session.STORAGE_KEY]);
  const state = Session.reduce(previous, action);
  if (!stored[Session.STORAGE_KEY] || !Array.isArray(stored[Session.STORAGE_KEY].history)
    || (!stored[Session.STORAGE_KEY].active && previous.active)
    || state.revision !== previous.revision) {
    await chrome.storage.local.set({ [Session.STORAGE_KEY]: state });
  }
  await schedule(state);
  return state;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.channel !== 'lock-in-buddy' || sender.id !== chrome.runtime.id) return;
  enqueue(async () => {
    if (request.command === 'session') return { state: await updateSession(request.action) };

    // Derive the website from Chrome's sender metadata, not from a supplied key.
    const origin = new URL(sender.url).origin;
    const uiKey = Session.UI_PREFIX + origin;
    if (request.command === 'load') {
      const state = await updateSession({ type: 'reconcile' });
      const stored = await chrome.storage.local.get(uiKey);
      return { state, ui: Session.normalizeUI(stored[uiKey]) };
    }
    if (request.command === 'ui') {
      const stored = await chrome.storage.local.get(uiKey);
      const ui = Session.normalizeUI({ ...Session.normalizeUI(stored[uiKey]), ...request.patch });
      await chrome.storage.local.set({ [uiKey]: ui });
      return { ui };
    }
    throw new Error('Unknown Buddy request.');
  }).then((result) => sendResponse({ ok: true, ...result }),
    (error) => sendResponse({ ok: false, error: error.message }));
  return true; // Keep the message response open while asynchronous work finishes.
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) enqueue(() => updateSession({ type: 'reconcile' })).catch(console.error);
});
chrome.runtime.onStartup.addListener(() => enqueue(() => updateSession({ type: 'reconcile' })).catch(console.error));
chrome.runtime.onInstalled.addListener(() => enqueue(() => updateSession({ type: 'reconcile' })).catch(console.error));

// Recreate a missing alarm whenever the worker wakes up, including after a restart.
enqueue(() => updateSession({ type: 'reconcile' })).catch(console.error);
