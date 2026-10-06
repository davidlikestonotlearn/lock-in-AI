// Chrome runs this file as a content script. The dashboard loads it with a script tag.
// An IIFE

(() => {
  // Do not add another buddy if these scripts run a second time.
  // If the website happens to use this ID, leave its element alone too.
  if (document.getElementById('lock-in-buddy-root')) return;

  const root = document.createElement('div');
  root.id = 'lock-in-buddy-root';
  root.dataset.lockInBuddyRoot = 'true';

  // This is fixed HTML written by us. Chat input is displayed with textContent in buddy.js.
  // Prefixing IDs keeps names like "messages" and "chat-input" available to the website.
  root.innerHTML = `
    <section id="lock-in-buddy-panel" class="buddy-panel" aria-label="Buddy panel" hidden>

      <header class="panel-header">
        <div class="mini-buddy" aria-hidden="true">••</div>
        <div><h2>Your buddy</h2><p><span class="status-dot"></span> Here for you</p></div>
        <button id="lock-in-buddy-close-panel" class="icon-button" aria-label="Close buddy panel" type="button">×</button>
      </header>

      <div class="tabs" role="tablist" aria-label="Buddy tools">
        <button id="lock-in-buddy-chat-tab" class="tab active" role="tab" aria-selected="true" aria-controls="lock-in-buddy-chat-view" type="button">Chat</button>
        <button id="lock-in-buddy-timer-tab" class="tab" role="tab" aria-selected="false" aria-controls="lock-in-buddy-timer-view" tabindex="-1" type="button">Focus timer</button>
      </div>

      <div id="lock-in-buddy-chat-view" role="tabpanel" aria-labelledby="lock-in-buddy-chat-tab">
        <div id="lock-in-buddy-messages" class="messages" role="log" aria-live="polite" aria-label="Chat messages">
          <div class="message buddy-message">Let's lock in today! <br />What do you have to work on?</div>
          <p class="demo-note">Demo chat · simple automatic replies</p>
        </div>
        <form id="lock-in-buddy-chat-form" class="chat-form">
          <label class="sr-only" for="lock-in-buddy-chat-input">Message your buddy</label>
          <input id="lock-in-buddy-chat-input" placeholder="Tell buddy what’s on your mind…" maxlength="500" autocomplete="off" required />
          <button class="send-button" aria-label="Send message" type="submit">↑</button>
        </form>
      </div>

      <div id="lock-in-buddy-timer-view" class="timer-view" role="tabpanel" aria-labelledby="lock-in-buddy-timer-tab" hidden>
        <p class="timer-label">FOCUS TIME - LET'S LOCK IN</p>
        <div id="lock-in-buddy-timer-display" class="timer-display" role="timer" aria-label="Time remaining">25:00</div>
        <p id="lock-in-buddy-timer-status">Ready when you are.</p>
        <div class="durations" aria-label="Timer duration">
          <button data-minutes="5" aria-pressed="false" type="button">5 min</button>
          <button data-minutes="10" aria-pressed="false" type="button">10 min</button>
          <button data-minutes="25" class="selected" aria-pressed="true" type="button">25 min</button>
        </div>
        <button id="lock-in-buddy-start-timer" class="primary-button" type="button">Start focusing</button>
        <button id="lock-in-buddy-reset-timer" class="reset-button" type="button">Reset timer</button>
        <p id="lock-in-buddy-timer-announcement" class="sr-only" aria-live="polite"></p>
      </div>

      <div class="panel-footer">Small steps count, too.</div>
    </section>

    <button id="lock-in-buddy-button" class="buddy" aria-label="Open buddy chat. Drag to move." aria-expanded="false" aria-controls="lock-in-buddy-panel" type="button">
      <span class="buddy-face" aria-hidden="true"><span class="eyes"><i></i><i></i></span><span class="smile"></span></span>
    </button>
  `;

  // Keep the buddy outside the website's app container so in-page navigation leaves it in place.
  document.body.append(root);
})();
