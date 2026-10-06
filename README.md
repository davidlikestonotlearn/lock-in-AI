# Lock In Buddy

A draggable study buddy with demo chat and a focus timer. It runs in the local dashboard and as a Chrome extension on `https://www.youtube.com/*` and `https://www.google.com/*`.

## How the files work together

1. `styleBuddy.css` styles only the container created for the buddy and its descendants.
2. `appear.js` creates that container, the buddy button, and the chat/timer panel.
3. `buddy.js` finds elements inside that container and attaches dragging, chat, and timer behavior.

`appear.js` is the extension's **content script**: that describes how Chrome runs the file, not a required filename. A separate `content.js` is unnecessary here.

The dashboard loads `appear.js` before `buddy.js` using deferred script tags. Chrome loads them in the same order through `manifest.json`. Keep that order so the elements exist before their event listeners are attached.

## Try the dashboard

Open `dashboard/index.html` in your browser. It uses the same creation and behavior scripts as the extension, so buddy's HTML only needs to be maintained in `appear.js`.

## Load the Chrome extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this project's root folder, `lock-in-buddy` (the folder containing `manifest.json`, not the `dashboard` folder).
4. Open or refresh a YouTube or Google Search tab. Buddy should appear near the bottom-right corner.

After editing extension files, click **Reload** on the extension's card and refresh the website tab to load your changes. Refreshing the dashboard alone is enough when testing the dashboard.

Try dragging buddy, opening and closing the panel, switching between chat and timer, sending a message, and starting, pausing, and resetting the timer. On YouTube, navigate between videos and check that there is still only one buddy.

Chrome's official [content-script reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts) explains the manifest configuration, and its [Hello World tutorial](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world) covers loading an unpacked extension.

## Keeping the website separate

- All buddy IDs start with `lock-in-buddy-`, including labels and accessibility references.
- `buddy.js` searches inside `root` for controls. Its only document-level lookup finds that container; `document.createElement` creates new elements.
- Every buddy CSS selector targets the marked root or something inside it. The reset rule also stays inside the root. Dashboard layout styles are loaded only by the dashboard.
- The transparent container lets pointer clicks reach the website. Only buddy's button and panel receive clicks.
- Keyboard shortcuts and clicks from inside buddy stop bubbling to the website. Escape closes the panel when focus is inside buddy; website keyboard events stay outside buddy's handler.
- Running both scripts again does not create a second buddy or attach its listeners again.

## Current limits

Chat uses simple automatic replies, not an AI service. Position, messages, and timer state are kept in memory for the current page and reset on a full reload. Normal YouTube navigation can keep them because the buddy sits outside YouTube's app container.

Google support currently means `www.google.com`, not Gmail, Google Docs, or regional Google domains. There is no toolbar popup or background service worker; neither is needed for this version to appear automatically on the selected websites.
