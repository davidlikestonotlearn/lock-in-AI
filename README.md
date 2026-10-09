# Lock In Buddy

A draggable study buddy with saved tasks, demo chat, and a shared focus timer. It runs on `https://www.youtube.com/*` and `https://www.google.com/*`, with a standalone dashboard for development. Chat uses preset replies; no AI service or API key is involved.

## Try the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this project's root folder, `lock-in-buddy` (the folder containing `manifest.json`).
3. If already installed, click **Reload** on the extension's card. This version adds the `storage` and `alarms` permissions.
4. Refresh your YouTube and Google tabs so they run the updated scripts.
5. Click Buddy, save a task and an optional first small step, then click **Start 25 min focus**. You can choose 5, 10, or 25 minutes in the timer tab before starting.

You can also tell Buddy your task in chat when no task is set. For example, send “Study biology,” then add “Review five flashcards” as your small step in the task editor.

## What is saved and shared

| Data | Behavior |
| --- | --- |
| Task, first step, task completion | One shared focus plan across supported extension tabs |
| Timer duration, status, remaining time / finish timestamp | Start, pause, resume, or reset from any supported tab |
| Chat | One shared conversation; the latest 100 messages are kept |
| Buddy position | Saved separately for each website and clamped to fit the current window |
| Open/closed panel and selected tab | Restored on refresh, separately for each website |

The session survives page refreshes, extension reloads, and browser restarts. A running timer uses real elapsed time: closing a tab or sleeping your computer does **not** pause it. If the deadline passes while you're away, Buddy completes the session and shows the check-in when you return. A paused timer keeps its remaining time until you resume.

Saving a **changed task or first step** resets the timer. Choosing a duration also resets it; duration buttons are disabled while running. Reset keeps the task and conversation. Changes synchronize the shared session, while opening the panel or moving Buddy in one tab does not move or open other already-visible panels. New tabs and refreshed tabs use that website's latest saved panel settings.

Everything is saved locally in your Chrome profile. No page content or chat is sent to a server. Uninstalling the extension removes its extension storage.

## Chat and timer flow

Set a task → optionally name a small first step → start focusing → check in.

| Chat message | Effect |
| --- | --- |
| A task description, when no task is set | Saves that message as the current task |
| `start` or `resume` | Starts or resumes the current task's timer |
| `break` (or a message containing `tired`, `break`, or `rest`) | Pauses a running timer and suggests taking a breather |
| `more time` | Resumes a paused timer, or starts another full focus period after completion |
| `done` or `finished` | Marks the current task complete and stops its timer |

When focus time ends, Buddy posts one shared check-in asking how it went. You can reply in chat or click **Check in with Buddy** from the timer. Commands such as `done` are matched as complete messages, so “not done” does not accidentally finish your task. Use the task editor to begin a different task.

## Try the dashboard

Open `dashboard/index.html` for a quick single-page preview. For dependable synchronization between dashboard tabs, serve the project over localhost:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/dashboard/` in two tabs. The dashboard uses `localStorage`, storage events, and the browser's Web Locks API to share its own session. Keep both tabs on the same origin: `localhost` and `127.0.0.1` have separate storage.

The standalone dashboard's data is separate from the installed extension's data. Direct `file://` previews have browser-dependent storage behavior; use localhost for multi-tab testing. The dashboard has no background worker, so with all dashboard tabs closed it records an expired timer's check-in the next time you open it. The extension uses a Chrome alarm to handle completion even with no website tabs open.

## How the code works — a learning walkthrough

1. **`session.js`: the rules.** Defines the saved state and a `reduce(state, action)` function. An action is a small instruction such as `{ type: 'pause' }`. The function calculates the next state without touching the page or saving anything. Both the extension and dashboard use these same rules.
2. **`background.js`: the extension's coordinator.** Receives commands from all supported tabs, reads the latest saved session, applies an action, and saves the result. A promise queue processes commands one at a time so two tabs cannot accidentally overwrite each other's messages. It schedules a Chrome alarm for the running timer.
3. **`storage.js`: the connection.** Gives the UI the same `load`, `dispatch`, `subscribe`, and `saveUI` methods in both environments. In the extension it messages the worker and listens to `chrome.storage.onChanged`. On the dashboard it uses local storage and a browser lock to coordinate tabs.
4. **`appear.js`: the HTML.** Creates the task editor, buddy button, chat, and timer once.
5. **`buddy.js`: the interaction.** Handles dragging, keyboard controls, forms, and rendering. It sends commands through the storage adapter instead of keeping an independent timer in each tab.
6. **`styleBuddy.css`: the widget's appearance.** Its selectors are scoped to Buddy's root. `dashboard/styles.css` styles only the playground.

The scripts load in this order: `session.js` → `storage.js` → `appear.js` → `buddy.js`. The worker separately loads `session.js` with `importScripts`.

### Why store a finish timestamp?

If you start a 10-minute timer at 2:00 PM, save a deadline of 2:10 PM. At 2:03 PM, any tab can calculate seven minutes left:

```js
remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
```

The interval only updates the display. It does not save a new countdown every second. Pausing calculates and saves the remaining seconds, and resuming creates a new deadline from those seconds.

### Why add a background worker?

Two content scripts have separate JavaScript memory. The worker coordinates their commands, and storage keeps the result even if Chrome shuts down the idle worker. Alarms wake it to reconcile completion; startup also restores missing alarms. Completion changes the status from `running` to `completed`, so a second tab checking the same deadline cannot post another completion message.

Session updates carry an increasing `revision`. The client ignores an older response if it has already received a newer state through a storage event. Panel settings use different storage keys, so saving a drag position cannot overwrite the shared timer.

## Verification

Run the dependency-free tests with Node.js:

```bash
node tests/session.test.cjs
```

These cover elapsed time after restoration, pause/resume, check-in commands, changing tasks, bounded history, overlapping tab commands, worker restart and alarm restoration, website-specific UI settings, and single completion messages.

`tests/browser-smoke.cjs` adds optional end-to-end checks using Playwright and its Chromium browser. With Playwright available to Node, run `node tests/browser-smoke.cjs`. It loads the actual extension against mocked website responses and checks the standalone dashboard over a temporary localhost server. Screenshots and the temporary browser profile stay outside the project.

Try these browser checks after reloading the extension:

1. On YouTube, save a task, drag Buddy, select five minutes, and start the timer.
2. Refresh. The task, messages, position, open panel, selected tab, and elapsed countdown should return.
3. Open Google in another tab. Open Buddy: it should show the same task, messages, and remaining time.
4. Pause on Google. YouTube should also show a paused timer. Refresh while paused and then resume from either tab.
5. Send `break`, `more time`, and `done` in chat. Check that the timer changes in both tabs.
6. Start again, then change the task. Both tabs should show the new task and a reset timer.
7. Let a five-minute period finish. Each tab should show the same single check-in message.
8. Navigate between YouTube videos and resize the window. Check for one Buddy and reachable controls.
9. Try keyboard navigation: Tab reaches controls, arrow keys switch tabs, and Escape closes the panel from inside Buddy.

## Keeping the website separate

- Buddy IDs start with `lock-in-buddy-`, including labels and accessibility references.
- Element lookups stay inside Buddy's own marked container.
- Widget CSS resets and styling are scoped to that container.
- Only Buddy's button and panel receive pointer clicks; the transparent overlay lets other clicks reach the website.
- Keyboard events and clicks inside Buddy stop bubbling to the website.
- User text is displayed with `textContent`, not inserted as HTML.
- Running the creation and behavior scripts again does not duplicate Buddy or its listeners.

Google support currently means `www.google.com`, not Gmail, Docs, or regional domains. This version has no toolbar popup, operating-system notifications, or AI integration. Timer completion appears inside Buddy's panel.

Chrome references: [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Content scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts).
