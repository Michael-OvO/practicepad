# Timer refinement — design

Refines the top-bar interview timer from a row of form controls into a single
instrument, and replaces the select-plus-number-field with a purpose-built
session length picker. The state machine, persistence format and palette
commands are unchanged; behaviour in the simulator spec
(`2026-09-17-coderpad-simulator-design.md`, "Timer") holds unless listed under
"Behaviour additions".

## Problems with the previous timer

- A bordered container held a bordered native `<select>`, a bordered number
  input and bordered text buttons: up to four nested outlines in 28px.
- Idle showed the length twice (`45:00` beside `45 min`).
- Paused was indistinguishable from running except for one button label.
- No indication of how far through the session you are.
- Warning and expired drew a hard coloured outline around everything; the
  readout used a slashed-zero mono face.
- The pill's width changed with every state (≈300 → 260 → 215px), and on a
  390px screen the custom-length state truncated the pad title to "U…".
- Reset discarded a running session instantly and sat beside Pause.

## The pill

28px tall, same border, radius and inset background as the palette trigger
beside it; nothing inside it has a border. Left to right:

1. **Progress ring** — 16px SVG, decorative. The arc is the share of the
   session *remaining*; it drains clockwise from 12 o'clock. Its colour carries
   the state: quiet outline at rest, green while live, grey while paused, amber
   in the last five minutes, an empty red ring once time is up. It sweeps back
   to full after a reset (the one authored motion; it never animates while the
   clock runs).
2. **Readout** — `MM:SS` in the sans face with tabular figures.
   - *Idle:* ring + readout + chevron are one button that opens the session
     length picker.
   - *Paused:* digits dim and the colon breathes.
   - *Expired:* replaced by "Time's up".
3. **Controls**, right-aligned:
   - *Idle:* **Start**, a tinted text button. Text rather than a play icon,
     because a green ▶ already means "Run code" in the editor toolbar.
   - *Running / paused:* icon buttons **Pause** / **Resume** and **Reset**.
   - *Expired:* **Reset** only.
   Start, Pause and Resume are one DOM button, so keyboard focus survives each
   transition; after a reset, focus moves to Start.

Running, paused, confirming and expired share one width (138px); idle is 148px.
Only the pill's left edge moves, and nothing else in the top bar reflows.

## Session length picker

A native `popover="auto"` (light dismiss, Escape, focus return — the same "let
the platform do it" choice as the palette's `<dialog>`), hung from the pill's
right edge with CSS anchor positioning, with a fixed top-right fallback.

- **Header:** "Session length", and the clock time the session would end if
  started now (refreshed every 10s while open).
- **Value:** the minutes as a directly editable number, centred over the needle
  so the two read as one dial. Typing applies live; blur normalises to 1–180.
- **Ruler:** a tape that slides under a fixed needle, 7px to the minute, ticks
  at 1 / 5 / 10 minutes, labels every 10, edges faded. It is a `role="slider"`
  and takes focus when the popover opens.
  - Drag to scrub (follows the pointer between minutes, settles on release).
  - Click a spot to bring that minute to the needle.
  - Horizontal or vertical wheel / trackpad scroll.
  - Arrows ±1; Shift+arrow and Page keys to the next multiple of five;
    Home / End for 1 / 180.
- **Presets:** 30 / 45 / 60 min as quiet buttons; the ruler glides to the
  chosen value. The popover stays open so the choice can be seen and adjusted.
- Enter closes the popover. The pill's Start button works while it is open
  (light dismiss lets the click through).

The body is mounted on `beforetoggle` (so it exists for the first paint) and
unmounted on `toggle` after closing (unmounting earlier removes the focused
control before the browser can return focus to the timer).

## Behaviour additions

- **Two-step reset.** While running or paused, the first activation of Reset
  arms it: the same button (so focus is kept) becomes a danger-tinted "Reset?"
  and Pause/Resume is hidden. A second activation resets. It disarms after 3s,
  on blur, on Escape, or when the timer state changes. A second click within
  400ms is ignored, so a double-click cannot confirm. Reset from the expired
  state, and the palette's "Timer: Reset", stay one step.
- **Time in the tab title.** Running: `32:14 · PracticePad`. Paused:
  `32:14 paused · PracticePad`. Expired: `Time's up · PracticePad`. Idle: the
  plain app title. Browsers throttle a hidden tab's timers to as little as once
  a minute, which is exactly when the title is being read, so the hook's tick
  comes from a small dedicated worker (falling back to `setInterval`).

## Code

- `timer/timer.ts` — pure `remainingFraction`, `stepMinutes`, `timerTitle`.
- `timer/tick.worker.ts`, `timer/createTicker.ts` — the tick source.
- `timer/useTimer.ts` — uses the ticker; exposes `fraction`; sets `document.title`.
- `components/Timer.tsx` — the pill, ring and two-step reset.
- `components/TimerLengthPopover.tsx` — the picker and its ruler.
- `components/icons.tsx` — Pause, Reset and Chevron icons; `PlayIcon` takes a size.
- `styles.css` — Timer block replaced; `palette-in` keyframes renamed `pop-in`
  now that the popover shares them.

## Testing

- Unit: `remainingFraction`, `stepMinutes`, `timerTitle`.
- E2E: the original timer test passes unchanged. Added: the picker (ruler focus,
  keys, preset, Escape returning focus, drag, typed value, Enter, lock after
  start) and two-step reset with the tab title.
- Visual: every state in both themes at 1280px, and dark at 390px.
