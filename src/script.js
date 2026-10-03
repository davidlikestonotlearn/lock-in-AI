const buddy = document.querySelector('#buddy');
const panel = document.querySelector('#buddy-panel');
const chatTab = document.querySelector('#chat-tab');
const timerTab = document.querySelector('#timer-tab');

// Place the open panel near buddy without going off-screen.
function positionPanel() {
  // An early return stops the function when there is nothing to position.
  if (panel.hidden) return;

  // This rectangle gives buddy's current position and size in the browser window.
  const rect = buddy.getBoundingClientRect();
  panel.style.maxHeight = `${window.innerHeight - 24}px`; // Limits the panels height
  panel.style.overflowY = 'auto'; // Allows overflow, scrolling if necessary

  const left = rect.right - panel.offsetWidth; // Calculate the panel's left position so its right edge aligns with buddy's.
  const above = rect.top - panel.offsetHeight - 12; // Calculate where the panel's top would be if placed above buddy with a 12px gap.
 
  // condition ? valueIfTrue : valueIfFalse chooses above or below buddy.
  const top = above >= 12 ? above : rect.bottom + 12;
  // Math.min sets the upper limit; Math.max sets the lower limit (a 12px margin).
  panel.style.left = `${Math.max(12, Math.min(left, window.innerWidth - panel.offsetWidth - 12))}px`;
  panel.style.top = `${Math.max(12, Math.min(top, window.innerHeight - panel.offsetHeight - 12))}px`;
}

// Show the panel when open is true; hide it when false.
// It also moves keyboard focus and tells screen readers whether the panel is open.
function setPanelOpen(open) {
  // ! reverses a boolean, if open/true, hidden is false. vice versa
  panel.hidden = !open;

  buddy.setAttribute('aria-expanded', String(open));
  positionPanel(); // Runs panel positioning

  // When opening, put keyboard focus on the selected tab button.
  // Focus moves the keyboard to that tab
  if (open) (chatTab.classList.contains('active') ? chatTab : timerTab).focus();
  else buddy.focus(); // Focus keyboard on buddy if panel isn't open
}

// Dragging state: null means no drag is happening; otherwise drag stores its details.
// suppressClick prevents releasing a drag from also opening or closing the panel.
// Pointer events work for a mouse, touch screen, or pen.
let drag = null;
let suppressClick = false;
// This callback runs when a pointer presses buddy. Save where the drag began.
buddy.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return; // 0 is left click, everything else, ignore this function

  const rect = buddy.getBoundingClientRect();
  drag = {x: event.clientX, // Pointers horizontal & vertical position
          y: event.clientY, 
          left: rect.left, // Buddys hori & vert position
          top: rect.top, 
          moved: false }; // Determines if a press is a drag
  suppressClick = false; 

  // Keep receiving pointer events even when the pointer leaves buddy's circle.
  buddy.setPointerCapture(event.pointerId); 
});

// While dragging, move buddy by the distance the pointer has traveled.
buddy.addEventListener('pointermove', (event) => {
  if (!drag) return; // Stop if there is no active drag to track.

  // Calculates the position how far the pointer move from where you pressed
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;

  // Ignore tiny movements so a slightly shaky click still counts as a click.
  if (Math.hypot(dx, dy) > 5) drag.moved = true; // Move more than 5px - drag moved
  if (!drag.moved) return; // If not, return

  buddy.classList.add('dragging'); // Adds dragging cursor

  // Move buddy to his starting position plus pointer movement, keeping him inside the window.
  buddy.style.left = `${Math.max(0, Math.min(drag.left + dx, window.innerWidth - buddy.offsetWidth))}px`;
  buddy.style.top = `${Math.max(0, Math.min(drag.top + dy, window.innerHeight - buddy.offsetHeight))}px`;
  positionPanel();
});


// Clear the dragging state and remember whether to ignore the next click.
// Several pointer events share this function because each can end a drag.
function finishDrag() {
  if (!drag) return;
  suppressClick = drag.moved;
  drag = null;
  buddy.classList.remove('dragging');
}

buddy.addEventListener('pointerup', finishDrag);
buddy.addEventListener('pointercancel', finishDrag);
buddy.addEventListener('lostpointercapture', finishDrag);

// A normal click toggles the panel; a click caused by dragging is ignored.
buddy.addEventListener('click', (event) => {
  // detail === 0 includes keyboard clicks, which should still work after dragging.
  if (suppressClick && event.detail !== 0) // If you are releasing 
    { suppressClick = false; return; }  // Clear the flag and exit before toggling the panel.

  setPanelOpen(panel.hidden);
});

// Clicking the close button calls setPanelOpen with false to hide the panel.
document.querySelector('#close-panel').addEventListener('click', () => setPanelOpen(false));

// This keyboard callback lets Escape close an open panel.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !panel.hidden) setPanelOpen(false);
});

// When the window changes size, keep buddy and its panel inside the new boundaries.
window.addEventListener('resize', () => {
  const rect = buddy.getBoundingClientRect();
  buddy.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - buddy.offsetWidth))}px`;
  buddy.style.top = `${Math.max(0, Math.min(rect.top, window.innerHeight - buddy.offsetHeight))}px`;
  positionPanel();
});

// Show the view belonging to the supplied chat or timer button.
function switchTab(tab) {
  // forEach runs this callback once for each button, updating both tabs.
  [chatTab, timerTab].forEach((button) => {
    const selected = button === tab; // Returns true or false based on what tab is 
    button.classList.toggle('active', selected); // Add the active class when selected; remove it otherwise.
    button.setAttribute('aria-selected', String(selected));
    
    // Only the selected tab is reached with the Tab key; arrows switch between tabs.
    button.tabIndex = selected ? 0 : -1;
    // aria-controls contains the ID of the view this button belongs to.
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
  });
  positionPanel(); // Fix the position since chat and timer have different heights
}

// Set up the same click and keyboard behavior for each tab button.
[chatTab, timerTab].forEach((tab) => {
  // A click selects this particular tab.
  tab.addEventListener('click', () => switchTab(tab));
  // Arrow keys switch tabs; Home selects chat and End selects the timer.
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); // Stop these keys from scrolling the page.
    const next = event.key === 'Home' ? chatTab : event.key === 'End' ? timerTab : tab === chatTab ? timerTab : chatTab;
    switchTab(next);
    next.focus();
  });
});

const messages = document.querySelector('#messages');
// Create a chat bubble and scroll to the latest message.
// text is the message content; sender is 'user' or 'buddy' and chooses its CSS style.
function addMessage(text, sender) {
  const message = document.createElement('div');
  message.className = `message ${sender}-message`;

  // textContent safely displays user input as text.
  message.textContent = text;
  messages.append(message);
  messages.scrollTop = messages.scrollHeight; // Scroll to the bottom so the newest message is visible.
}

// This callback runs when the chat form is submitted (Send button or Enter key).
// It displays your message, clears the input, and picks a simple demo reply.
document.querySelector('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault(); // Stop the form's default behavior of reloading the page.
  const input = document.querySelector('#chat-input');
  const text = input.value.trim();

  if (!text) return; // If there is no text

  addMessage(text, 'user');
  input.value = '';

  // BASE REPLY
  let reply = 'Let’s make it small: pick one step you can finish, then start a focus timer. I’m cheering you on!';
  // These regular expressions look for whole words: \b = word boundary, | = or,
  // i = ignore capitalization. test(text) returns true when a word matches.
  if (/\b(tired|break|rest)\b/i.test(text)) reply = 'A breather can help. Take 5 or 10 minutes, stretch a little, and come back to one small step.';
  else if (/\b(hello|hi|hey)\b/i.test(text)) reply = 'Hey there! What would you like to make progress on today?';
  else if (/\b(done|finished)\b/i.test(text)) reply = 'Look at you go! Take a moment to enjoy that progress. What’s next: a break or another small step?';
  addMessage(reply, 'buddy');
});

// TIMER 

// Timer state: duration and remaining are in seconds; endTime is in milliseconds.
// interval stores the ID returned by setInterval; null means the timer is stopped.
// Use an end time so elapsed time is counted even if the browser delays an interval.
let duration = 25 * 60;
let remaining = duration;
let endTime = null;
let interval = null;
const display = document.querySelector('#timer-display');
const timerStatus = document.querySelector('#timer-status');
const startButton = document.querySelector('#start-timer');
const announcement = document.querySelector('#timer-announcement');

// Convert remaining seconds into a display like "04:09".
// This only updates the display; it does not start or stop the timer.
function renderTimer() {
  // floor() gives whole minutes; % gives leftover seconds; padStart adds a leading 0.
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  display.textContent = `${minutes}:${seconds}`;
}

// Stop repeated ticks and clear the timer's running state.
// remaining is kept so the timer can resume from the same number of seconds.
function stopInterval() {
  clearInterval(interval);
  interval = null;
  endTime = null;
}

// Calculate how much time is left, update the display, and handle completion.
// Called repeatedly while running, and once just before pausing.
function tick() {
  // Date.now() gives milliseconds. Divide by 1000 for seconds, round up,
  // and use Math.max to prevent a negative countdown.
  remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
  renderTimer();

  if (remaining === 0) {
    stopInterval();
    timerStatus.textContent = 'Nice work! Time for a breather.';
    startButton.textContent = 'Start again';
    announcement.textContent = 'Timer complete. Nice work! Time for a breather.';
    addMessage('Your timer is done! Take a breath and celebrate showing up.', 'buddy');
  }
}

// Clicking the main timer button pauses a running timer or starts/resumes a stopped one.
startButton.addEventListener('click', () => {
  if (interval !== null) { // Timer is running - pause it
    tick();

    // tick() may have just finished the timer; don't replace its completion message.
    if (interval === null) return;

    stopInterval();
    timerStatus.textContent = 'Paused. Take your time.';
    startButton.textContent = 'Resume focusing';

  } else { // Timer is stopped - start or resume 
    if (remaining === 0) remaining = duration; // If the timer finished, restore duration

    // Set a new finish time using the current time plus the remaining seconds.
    endTime = Date.now() + remaining * 1000;

    // Pass the function itself: setInterval calls tick every 250 milliseconds.
    interval = setInterval(tick, 250);

    timerStatus.textContent = 'One thing at a time. You’ve got this.';
    startButton.textContent = 'Pause timer';
    announcement.textContent = '';
    renderTimer();
  }
});

// Stop the countdown, restore the selected duration, and reset the labels.
function resetTimer() {
  stopInterval();
  remaining = duration;
  renderTimer();
  timerStatus.textContent = 'Ready when you are.';
  startButton.textContent = 'Start focusing';
  announcement.textContent = '';
}

// Give the reset button the function to run when clicked.
document.querySelector('#reset-timer').addEventListener('click', resetTimer);

// Find all duration buttons and attach a click callback to each one.
document.querySelectorAll('[data-minutes]').forEach((button) => {

  // Selecting a duration starts over with that many seconds (it does not start counting).
  button.addEventListener('click', () => {
    duration = Number(button.dataset.minutes) * 60; // Switches the duration * 60 to get the amount of seconds
    
    // Update each button so only the clicked one looks selected and is announced as pressed.
    document.querySelectorAll('[data-minutes]').forEach((choice) => {
      choice.classList.toggle('selected', choice === button);
      choice.setAttribute('aria-pressed', String(choice === button));
    });

    resetTimer();
  });
});
