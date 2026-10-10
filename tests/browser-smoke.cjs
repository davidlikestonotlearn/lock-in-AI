// Optional end-to-end checks. Requires Playwright and its Chromium browser.
// Run: node tests/browser-smoke.cjs
// Website responses are mocked; the extension itself runs normally in Chromium.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const id = (page, name) => page.locator(`#lock-in-buddy-${name}`);

async function waitText(page, name, text) {
  await page.waitForFunction(({ name, text }) => document.getElementById(`lock-in-buddy-${name}`)?.textContent === text, { name, text });
}
async function ready(page) {
  await id(page, 'chat-input').waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.getElementById('lock-in-buddy-chat-input').disabled);
}
async function chat(page, text) {
  await id(page, 'chat-tab').click();
  await id(page, 'chat-input').fill(text);
  await id(page, 'chat-input').press('Enter');
  await page.waitForFunction(() => !document.getElementById('lock-in-buddy-chat-input').disabled
    && document.getElementById('lock-in-buddy-chat-input').value === '');
}

(async () => {
  const errors = [];
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lock-in-buddy-browser-'));
  let context;
  const server = http.createServer(async (request, response) => {
    try {
      let pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(project, `.${pathname}`);
      if (!file.startsWith(project + path.sep)) throw new Error('Invalid path');
      const content = await fs.readFile(file);
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[path.extname(file)];
      response.writeHead(200, { 'Content-Type': type || 'text/plain' });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${project}`, `--load-extension=${project}`],
    });
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    await context.route(/https:\/\/www\.(youtube|google)\.com\//, (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><head><title>Host page</title><style>button { background: red; } input { width: 9999px; }</style></head><body><h1>Host page</h1><input id="host-input" /></body></html>',
    }));
    await context.route('https://fonts.googleapis.com/**', (route) => route.abort());
    let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');

    const youtube = await context.newPage();
    await youtube.goto('https://www.youtube.com/watch?v=test');
    await ready(youtube);
    // Dragging should move Buddy without opening it.
    const box = await id(youtube, 'button').boundingBox();
    await youtube.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await youtube.mouse.down();
    await youtube.mouse.move(400, 700, { steps: 10 });
    await youtube.mouse.up();
    assert.equal(await id(youtube, 'panel').isVisible(), false);
    const dragged = await id(youtube, 'button').boundingBox();
    await id(youtube, 'button').click();
    await id(youtube, 'task-input').fill('Study biology');
    await id(youtube, 'step-input').fill('Review five flashcards');
    await id(youtube, 'save-task').click();
    await waitText(youtube, 'current-task', 'Study biology');
    await id(youtube, 'timer-tab').click();
    await youtube.locator('[data-minutes="5"]').click();
    await waitText(youtube, 'timer-display', '05:00');
    await id(youtube, 'chat-tab').click();
    await id(youtube, 'chat-focus').click();
    await waitText(youtube, 'start-timer', 'Pause timer');
    await youtube.waitForTimeout(1100);
    await youtube.reload();
    await ready(youtube);
    assert.equal(await id(youtube, 'panel').isVisible(), true);
    assert.equal(await id(youtube, 'timer-view').isVisible(), true);
    assert.equal(await id(youtube, 'current-task').textContent(), 'Study biology');
    assert.equal(await id(youtube, 'current-step').textContent(), 'First step: Review five flashcards');
    assert.notEqual(await id(youtube, 'timer-display').textContent(), '05:00');
    const restored = await id(youtube, 'button').boundingBox();
    assert.ok(Math.abs(restored.x - dragged.x) < 1 && Math.abs(restored.y - dragged.y) < 1);
    console.log('PASS extension refresh restores task, chat, timer, position, panel, and selected tab');

    const google = await context.newPage();
    await google.goto('https://www.google.com/search?q=study');
    await ready(google);
    await id(google, 'button').click();
    await waitText(google, 'current-task', 'Study biology');
    await id(google, 'timer-tab').click();
    await waitText(google, 'start-timer', 'Pause timer');
    await id(google, 'start-timer').click();
    await waitText(youtube, 'start-timer', 'Resume focusing');
    const paused = await id(youtube, 'timer-display').textContent();
    await youtube.reload();
    await ready(youtube);
    assert.equal(await id(youtube, 'timer-display').textContent(), paused);
    await id(youtube, 'start-timer').click();
    await waitText(google, 'start-timer', 'Pause timer');
    // An incoming sync must preserve an unsaved task draft.
    await google.locator('#lock-in-buddy-task-editor summary').click();
    await id(google, 'task-input').fill('An unsaved draft');
    await chat(youtube, 'break');
    await waitText(google, 'start-timer', 'Resume focusing');
    assert.equal(await id(google, 'task-input').inputValue(), 'An unsaved draft');
    await google.locator('#lock-in-buddy-task-editor summary').click();
    await chat(youtube, 'more time');
    await waitText(google, 'start-timer', 'Pause timer');
    console.log('PASS cross-website pause/resume, shared chat, and unsaved draft preservation');

    const dashboard = await context.newPage();
    const dashboardRequests = [];
    dashboard.on('request', (request) => dashboardRequests.push(request.url()));
    await dashboard.goto(`chrome-extension://${new URL(worker.url()).host}/dashboard/index.html`);
    await ready(dashboard);
    await dashboard.waitForFunction(() => document.getElementById('completed-count').textContent === '0');
    assert.match(await dashboard.locator('#data-source').textContent(), /Chrome profile/);
    assert.equal(await dashboard.locator('#history-empty').isVisible(), true);
    assert.equal(await dashboard.locator('#focus-heading').textContent(), 'Study biology');
    await dashboard.locator('#open-buddy').click();
    await waitText(dashboard, 'start-timer', 'Pause timer');
    await id(dashboard, 'start-timer').click();
    await waitText(youtube, 'start-timer', 'Resume focusing');
    const todayPaused = await dashboard.locator('#today-time').textContent();
    await dashboard.waitForTimeout(1200);
    assert.equal(await dashboard.locator('#today-time').textContent(), todayPaused);
    await id(dashboard, 'start-timer').click();
    await waitText(google, 'start-timer', 'Pause timer');
    console.log('PASS native extension dashboard shares current focus and excludes paused time');

    // Accelerate the saved deadline to test completion without a five-minute wait.
    await worker.evaluate(async () => {
      const key = 'lock-in-buddy-session-v1';
      const stored = await chrome.storage.local.get(key);
      stored[key].active.runStartedAt = Date.now() - stored[key].remaining * 1000 - 1;
      stored[key].active.startedAt = Math.min(stored[key].active.startedAt, stored[key].active.runStartedAt);
      stored[key].active.segments = [];
      stored[key].endTime = Date.now() - 1;
      stored[key].revision += 1;
      await chrome.storage.local.set(stored);
    });
    await waitText(youtube, 'start-timer', 'Start again');
    await waitText(google, 'start-timer', 'Start again');
    const completions = await worker.evaluate(async () => {
      const state = (await chrome.storage.local.get('lock-in-buddy-session-v1'))['lock-in-buddy-session-v1'];
      return state.messages.filter((message) => message.text.startsWith('Focus time is up')).length;
    });
    assert.equal(completions, 1);
    await dashboard.waitForFunction(() => document.getElementById('completed-count').textContent === '1');
    assert.equal(await dashboard.locator('#history-rows tr').count(), 1);
    assert.match(await dashboard.locator('#history-rows').textContent(), /Study biology/);
    await dashboard.reload();
    await ready(dashboard);
    await dashboard.waitForFunction(() => document.querySelectorAll('#history-rows tr').length === 1);
    await chat(google, 'done');
    await waitText(youtube, 'current-task', '✓ Study biology');
    // Restoring an open panel should leave the host page's focus alone.
    await youtube.reload();
    await ready(youtube);
    assert.equal(await youtube.evaluate(() => document.activeElement.tagName), 'BODY');
    await id(youtube, 'chat-tab').click();
    await id(youtube, 'chat-input').focus();
    const chatScroll = await id(youtube, 'messages').evaluate((log) => ({
      top: log.scrollTop, height: log.scrollHeight, visible: log.clientHeight,
    }));
    assert.ok(Math.abs(chatScroll.top - (chatScroll.height - chatScroll.visible)) <= 1);
    await youtube.keyboard.press('Escape');
    assert.equal(await id(youtube, 'panel').isVisible(), false);
    await id(youtube, 'button').press('Enter');
    assert.equal(await id(youtube, 'panel').isVisible(), true);
    assert.equal(await youtube.locator('#lock-in-buddy-root').count(), 1);
    const panelBox = await id(youtube, 'panel').boundingBox();
    const buddyBox = await id(youtube, 'button').boundingBox();
    assert.ok(panelBox.x + panelBox.width <= buddyBox.x || buddyBox.x + buddyBox.width <= panelBox.x
      || panelBox.y + panelBox.height <= buddyBox.y || buddyBox.y + buddyBox.height <= panelBox.y,
    'The open panel must not cover Buddy or let Buddy cover its controls');
    await youtube.screenshot({ path: path.join(os.tmpdir(), 'lock-in-buddy-extension.png') });
    await youtube.setViewportSize({ width: 390, height: 650 });
    const smallBox = await id(youtube, 'button').boundingBox();
    assert.ok(smallBox.x >= 0 && smallBox.x + smallBox.width <= 390);
    assert.ok(smallBox.y >= 0 && smallBox.y + smallBox.height <= 650);
    console.log('PASS single check-in, task completion, keyboard controls, focus restoration, and resize');

    // An early completion and a reset preserve partial time without duplicate rows.
    await dashboard.setViewportSize({ width: 1280, height: 900 });
    await chat(google, 'more time');
    await waitText(youtube, 'start-timer', 'Pause timer');
    await google.waitForTimeout(1100);
    await chat(youtube, 'done');
    await dashboard.waitForFunction(() => document.getElementById('completed-count').textContent === '2');
    assert.match(await dashboard.locator('#history-rows tr').first().textContent(), /Completed early/);
    await chat(google, 'more time');
    await google.waitForTimeout(1100);
    await id(google, 'timer-tab').click();
    await id(google, 'reset-timer').click();
    await dashboard.waitForFunction(() => document.querySelectorAll('#history-rows tr').length === 3);
    assert.equal(await dashboard.locator('#completed-count').textContent(), '2');
    assert.match(await dashboard.locator('#history-rows tr').first().textContent(), /Reset · partial/);
    // Unknown commands report an error and leave the saved history intact.
    const invalid = await dashboard.evaluate(() => chrome.runtime.sendMessage({
      channel: 'lock-in-buddy', command: 'session', action: { type: 'invalid' },
    }));
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /Unknown Buddy command/);
    assert.ok(dashboardRequests.every((url) => url.startsWith('chrome-extension://')), 'Dashboard assets must stay local');
    if (await id(dashboard, 'panel').isVisible()) await id(dashboard, 'close-panel').click();
    await dashboard.screenshot({ path: path.join(os.tmpdir(), 'lock-in-buddy-dashboard.png'), fullPage: true });
    await dashboard.setViewportSize({ width: 390, height: 650 });
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await dashboard.screenshot({ path: path.join(os.tmpdir(), 'lock-in-buddy-dashboard-mobile.png'), fullPage: true });
    console.log('PASS dashboard history, early completion, reset totals, refresh, error response, and mobile layout');

    // Browser restart with the same profile must restore a running timer and history.
    await chat(google, 'more time');
    const persisted = await worker.evaluate(async () => (await chrome.storage.local.get('lock-in-buddy-session-v1'))['lock-in-buddy-session-v1']);
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${project}`, `--load-extension=${project}`],
    });
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const reopened = await context.newPage();
    await reopened.goto(`chrome-extension://${new URL(worker.url()).host}/dashboard/index.html`);
    await ready(reopened);
    const restoredState = await worker.evaluate(async () => (await chrome.storage.local.get('lock-in-buddy-session-v1'))['lock-in-buddy-session-v1']);
    assert.equal(restoredState.endTime, persisted.endTime);
    assert.equal(restoredState.active.id, persisted.active.id);
    assert.equal(restoredState.history.length, 3);
    assert.equal(restoredState.status, 'running');
    assert.ok(await worker.evaluate(async () => Boolean(await chrome.alarms.get('lock-in-buddy-focus-complete'))));
    await reopened.waitForFunction(() => document.getElementById('completed-count').textContent === '2');
    // Playwright cannot click browser toolbar UI in headless mode.
    const opened = context.waitForEvent('page');
    // The handler itself is covered by the worker unit test. Open its exact URL
    // here to verify the target loads under extension CSP.
    await worker.evaluate(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') }));
    const actionPage = await opened;
    await actionPage.waitForURL('**/dashboard/index.html');
    await ready(actionPage);
    assert.equal(await actionPage.locator('#completed-count').textContent(), '2');
    console.log('PASS browser restart restores timer/history/alarm; native dashboard URL opens correctly');

    // The standalone dashboard should also persist and synchronize its own data.
    const url = `http://127.0.0.1:${server.address().port}/dashboard/`;
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto(url);
    await second.goto(url);
    await ready(first);
    await ready(second);
    await id(first, 'button').click();
    await id(second, 'button').click();
    await chat(first, 'Write an essay');
    await waitText(second, 'current-task', 'Write an essay');
    await id(first, 'chat-focus').click();
    await waitText(second, 'start-timer', 'Pause timer');
    await chat(second, 'break');
    await waitText(first, 'start-timer', 'Resume focusing');
    await first.reload();
    await ready(first);
    assert.equal(await id(first, 'current-task').textContent(), 'Write an essay');
    await first.screenshot({ path: path.join(os.tmpdir(), 'lock-in-buddy-preview.png') });
    const unsafeTask = '<img src=x onerror="window.injected=true">';
    await first.locator('#lock-in-buddy-task-editor summary').click();
    await id(first, 'task-input').fill(unsafeTask);
    await id(first, 'save-task').click();
    await waitText(first, 'current-task', unsafeTask);
    await id(first, 'chat-focus').click();
    await first.waitForTimeout(1100);
    await chat(first, 'done');
    await first.waitForFunction((task) => document.querySelector('#history-rows tr td')?.textContent === task, unsafeTask);
    assert.equal(await first.locator('#history-rows img, #lock-in-buddy-messages img').count(), 0);
    assert.equal(await first.evaluate(() => Boolean(window.injected)), false);
    console.log('PASS task names render safely as text in Buddy and dashboard history');
    const failurePreview = await context.newPage();
    await failurePreview.addInitScript(() => {
      const original = Storage.prototype.getItem;
      let fail = true;
      Storage.prototype.getItem = function (key) {
        if (key === 'lock-in-buddy-session-v1' && fail) {
          fail = false;
          throw new Error('Simulated storage read failure');
        }
        return original.call(this, key);
      };
    });
    await failurePreview.goto(url);
    await id(failurePreview, 'button').click();
    await id(failurePreview, 'retry-load').waitFor({ state: 'visible' });
    assert.match(await id(failurePreview, 'save-status').textContent(), /Simulated storage read failure/);
    await id(failurePreview, 'retry-load').click();
    await ready(failurePreview);
    assert.equal(await id(failurePreview, 'retry-load').isVisible(), false);
    console.log('PASS Buddy recovers from an initial storage read failure through retry');
    assert.deepEqual(errors, []);
    console.log('PASS dashboard refresh and multi-tab synchronization; no page errors');
  } catch (error) {
    if (context) {
      const worker = context.serviceWorkers()[0];
      if (worker) console.error('Saved session at failure:', await worker.evaluate(async () => {
        const state = (await chrome.storage.local.get('lock-in-buddy-session-v1'))['lock-in-buddy-session-v1'];
        return { status: state?.status, taskDone: state?.taskDone, history: state?.history,
          recentMessages: state?.messages.slice(-8) };
      }).catch(() => 'Worker unavailable'));
      for (const page of context.pages()) {
        if (page.url().includes('dashboard/index.html')) {
          console.error('Dashboard at failure:', await page.evaluate(() => ({
            count: document.getElementById('completed-count')?.textContent,
            status: document.getElementById('dashboard-status')?.textContent,
          })).catch(() => 'Page unavailable'));
        }
      }
    }
    throw error;
  } finally {
    if (context) await context.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
