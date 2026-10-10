# Lock-In Buddy

A local-first Chrome extension MVP built with vanilla JavaScript, HTML, and CSS. A draggable Buddy on YouTube and Google helps you set a task, run a shared focus timer, and check in through preset chat replies. The extension dashboard turns saved study sessions into useful statistics.

No build step, account, AI service, API key, or backend is required. Playwright is a development-only dependency for browser tests.

## Features

- Task and optional first small step, with a 5-, 10-, or 25-minute focus timer.
- Start, pause, resume, reset, and early completion through `done` in chat.
- One shared session and conversation across YouTube, Google, and the extension dashboard.
- Persistent task, chat (latest 100 messages), timer, and website-specific Buddy position, panel state, and selected tab.
- Study history: task, start/end dates, planned duration, actual timer-running time, and completed/reset result.
- Dashboard: today's study time, total completed sessions, all-time study time, average completed-session duration, current focus, and paginated history.
- Dashboard access from the extension toolbar icon; Buddy remains available on the dashboard.
- Keyboard controls, responsive dashboard, safe text rendering, and visible storage errors with loading retries.

## Install and use

1. Download or clone the project.
2. Open `chrome://extensions` in a current desktop Chrome browser and enable **Developer mode**.
3. Choose **Load unpacked** and select the project root containing `manifest.json`.
4. Pin **Lock In Buddy** using Chrome's extensions menu. Click its icon to open the dashboard.
5. Visit `https://www.youtube.com/` or `https://www.google.com/`, open Buddy, and save a task. Choose a duration in **Focus timer**, then start.

After updating the code, click **Reload** on the extension's card and refresh existing website/dashboard tabs. Existing timers keep their countdown on upgrade; historical focus time from before the history feature was installed cannot be recovered.

## How study time is counted

Study time means **time the focus timer is running**, not a measurement of attention or activity. Switching tabs, closing tabs, restarting the browser, and putting the computer to sleep do not pause a running timer. Pause it explicitly when taking a break. A late completion is dated at the timer's deadline and cannot exceed the planned duration.

| Action | History and statistics |
| --- | --- |
| Start | Creates a session ID and running interval |
| Pause | Saves elapsed milliseconds and exact remaining time; no final history row yet |
| Resume / `more time` while paused | Continues the same session ID; paused time is excluded |
| Timer expires | Saves one completed record, even if several tabs check at once |
| `done` while running or paused | Records only elapsed active time as completed early |
| `done` without an active timer | Marks the task done without inventing a focus session |
| Reset, change task/first step, or change duration while paused | Saves nonzero partial time as reset; does not increase completed sessions |
| Start again / `more time` after completion | Creates a new focus session |

A zero-time session does not create a history row. Reset retains the task and chat. Duration changes are disabled while running. Editing a changed task or first step resets the timer and records any partial time against the original task and duration.

Today's total includes active, paused, completed, and reset study time falling between local midnight and now. Saved running intervals split sessions correctly across midnight. The completed count and average use completed history records, including early completion; reset sessions contribute only to study-time totals. History dates use the viewer's current local timezone. Displayed durations are rounded down to seconds (hours display minutes); stored time uses milliseconds.

Chat is deliberately simple:

| Message | Effect |
| --- | --- |
| Task description when no task is set | Saves it as the task |
| `start`, `resume`, or `more time` | Starts/resumes the timer |
| Message containing `break`, `tired`, or `rest` | Pauses a running timer |
| `done` or `finished` | Marks the task complete and finishes an active session |

Completion commands match the entire message, so “not done” does not complete a task.

## Architecture

The original modules remain in place:

| File | Responsibility |
| --- | --- |
| `session.js` | Plain-data session rules, validation, interval accounting, history recording, and statistics |
| `background.js` | Single extension writer; serializes commands, persists state, schedules completion alarms, and opens the dashboard |
| `storage.js` | UI adapter: `load`, `dispatch`, `subscribe`, and `saveUI`; sends commands to the worker and listens for storage changes |
| `appear.js` | Creates the floating Buddy's HTML once, using scoped IDs |
| `buddy.js` | Forms, chat, dragging, keyboard interaction, rendering, and error/loading recovery |
| `styleBuddy.css` | Widget styling scoped to its root so website controls retain their own styles |
| `dashboard/index.html`, `script.js`, `styles.css` | Dashboard markup, rendering through the shared storage client, and responsive styling |
| `manifest.json` | Manifest V3 worker, toolbar action, storage/alarm permissions, and supported content-script URLs |

UI scripts load in order: `session.js` → `storage.js` → `appear.js` → `buddy.js`. The dashboard then loads its renderer. The worker loads `session.js` using `importScripts`.

### Engineering decisions

**Commands instead of whole-state replacements.** Each UI sends an intention such as `{ type: 'pause' }`. The worker reads the latest snapshot before applying it. An old tab cannot overwrite a newer tab's task or history with an outdated copy.

**One writer and one saved snapshot.** The worker's promise queue serializes commands, alarms, and startup reconciliation. The session, active intervals, and history are stored together under `lock-in-buddy-session-v1` in `chrome.storage.local`. Completion and its history entry are saved in the same write. Stable session IDs and completed status make repeated completion checks harmless. A failed write leaves the previously saved running state available for retry; failures do not stop the queue.

**Timestamps instead of ticking storage writes.** A running timer saves `endTime`, then each UI calculates `ceil((endTime - Date.now()) / 1000)` for display. Pausing saves exact remaining time and closes the running interval. Resuming opens another interval. This prevents repeated short pauses from losing time through rounding and lets the timer recover after reload/restart.

**Workers are temporary; storage is durable.** Chrome can stop an idle service worker. Startup, worker wake, alarms, and visible-tab reconciliation reload the saved state and repair missing alarms. Chrome may delay alarms; recording caps focus time at the deadline.

**Shared data, separate UI preferences.** `chrome.storage.onChanged` updates all clients. A revision counter prevents a slow response from repainting older session state. Buddy position/panel/tab preferences have separate keys per website, so a drag cannot overwrite the timer. User text is rendered with `textContent`.

## Privacy

The extension stores its data in `chrome.storage.local` in your Chrome profile. It does not upload data, read page contents, use Chrome sync, or load external fonts. It requests only `storage` and `alarms`; creating the dashboard tab does not require access to your browsing history. Uninstalling the extension removes its extension storage. Local data is not an encrypted backup.

## Tests

Use Node.js 20 or newer. Unit/integration tests use Node's built-in test runner and VM; they require no dependency installation:

```bash
npm test
# Or directly:
node tests/session.test.cjs
```

The suite exercises real session, worker, and client scripts with fake Chrome APIs: exact pause accounting, early completion, partial resets, midnight boundaries, invalid data/actions, storage-write failure and retry, concurrent tabs/alarms, worker restart, alarm restoration, UI isolation, toolbar action, and shared dashboard history.

For real Chromium extension tests:

```bash
npm ci
npx playwright install chromium
npm run test:browser
```

Linux may need Playwright's browser system libraries (`npx playwright install --with-deps chromium`). The browser suite runs headlessly with a temporary Chrome profile and mocked Google/YouTube responses. It checks refresh, drag/keyboard controls, cross-site synchronization, native dashboard statistics/history, early completion/reset, mobile layout, browser restart with the same profile, and standalone preview behavior. It accelerates a saved deadline rather than waiting five minutes. Temporary profiles are removed and screenshots are written under your OS temporary directory. You can set `CHROMIUM_EXECUTABLE_PATH` to use an existing compatible Chromium executable.

The toolbar handler is covered by a worker test; headless Playwright opens its destination URL because it cannot click Chrome's toolbar. Mocked host pages verify extension behavior but do not establish compatibility with every change to the live Google/YouTube websites. Automated browser restarts are graceful close/reopen, not power-loss simulations.

The implementation was verified with **23 passing unit/integration tests** and **9 passing browser workflow groups**, with no uncaught page errors.

### Manual demonstration

1. Start a five-minute task on YouTube and refresh. Check that the task and elapsed countdown survive.
2. Open Google and the dashboard using the pinned extension icon. Confirm the same task and timer everywhere.
3. Pause on Google. Wait several seconds; dashboard study time should stop increasing. Resume on YouTube.
4. Send `done` in Buddy. Confirm one **Completed early** history row with actual time below the planned five minutes.
5. Start again, wait briefly, and reset. Confirm a **Reset · partial** row and an unchanged completed-session count.
6. Start again, close/reopen Chrome, and open the dashboard. Confirm history and the running countdown return.
7. Let a timer expire with multiple tabs open. Confirm one check-in and one completed history record. Expiration with no website tabs open should be handled by the alarm, or reconciled next time Chrome/the dashboard opens.
8. Drag Buddy, refresh, resize, and navigate between YouTube videos. Verify one widget and reachable controls. Use Tab, arrow keys on Buddy tabs, and Escape to close the panel.

## Standalone development preview

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Visit `http://127.0.0.1:8000/dashboard/`. The preview labels itself clearly and uses **separate** `localStorage` data. Browser storage events and Web Locks coordinate preview tabs on the same origin; a custom event also updates Buddy and the dashboard within one page. It cannot read installed extension data and has no worker/alarm: expiry is reconciled when a preview tab is open again. For dependable synchronization use localhost rather than `file://`.

## Known limitations

- Only `www.youtube.com` and `www.google.com` are supported; regional Google domains, Gmail, and Docs are excluded.
- Running time includes time while away, asleep, or the browser is closed. It is not proof of focused work. System clock changes can affect timers; timezone changes affect today's grouping.
- No operating-system notifications, AI, authentication, backend, cloud sync, export, or history-deletion UI.
- History stays in one Chrome profile. There is no automatic backup or cross-device sharing.
- History is not silently truncated. Chrome's local-storage quota and increasingly large snapshots may eventually limit long-term use. Save failures appear in the UI; the MVP has no storage-management interface.
- Existing pre-history timers preserve their countdown but only record time from upgrade onward; previous chat and task data remain. Earlier sessions cannot be reconstructed.
- Reloading the extension invalidates old content-script connections; refresh those website tabs.
- A Chrome alarm may fire late. The next wake/load also checks expired timers, records the original deadline, and avoids duplicate history.

API references: [Chrome Storage](https://developer.chrome.com/docs/extensions/reference/api/storage), [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [Action](https://developer.chrome.com/docs/extensions/reference/api/action), [Extension worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
