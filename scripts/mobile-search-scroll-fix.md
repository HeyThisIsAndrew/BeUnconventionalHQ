# Fix: the search palette scrolls the page instead of its own results list (mobile)

**Reported:** on a phone, with the search open and the keyboard up, dragging the
results list scrolls the whole page behind the palette instead of the list.

**Branch:** cut from `main` (`24dca428` at time of writing). Not the LCP branch.

---

## What I verified before writing this

I traced it rather than guessing. Two independent causes, and the primary one
is that **the palette does not use the scroll lock this site already has.**

### 1. PRIMARY: the palette's scroll lock is the one that does not work on iOS

`src/components/CommandPalette.astro:528` locks the page like this:

```js
document.body.style.overflow = 'hidden';   // and '' again on close, line 556
```

iOS Safari ignores `overflow: hidden` on `<body>` for touch scrolling. This is
the well-known case, and **this repo already solved it**:
`src/styles/modules/ios-lock.css` locks with `position: fixed`, `width: 100%`,
`height: 100dvh`, `overflow: hidden`, and holds the scroll position with an
inline `top: -[scrollY]px`. It is applied by putting `modal-open` on `<html>`,
which is what the video modal does.

The palette never sets `modal-open`. It only mentions it in a comment at line
543, about a bug where the class was left behind on close.

**So the fix is to use the existing mechanism, not to invent a second one.**
Two scroll locks that disagree is how the bug at line 543 happened.

### 2. SECONDARY: the results list allows scroll chaining

`.cmd-palette-results` (`CommandPalette.astro:1050`) is `overflow-y: auto` and
there is **no `overscroll-behavior` anywhere in the file** (grep count: 0).

So even with a correct page lock, a drag that reaches the top or bottom of the
list chains to whatever is behind it. `overscroll-behavior: contain` on that
element stops the chain at the list's own boundary.

Both are needed. Either alone leaves a case: without the lock the page scrolls
from the first drag, and without `contain` it scrolls once the list bottoms out.

### 3. NOT the cause: the height is already right

Do not "fix" the sizing. `.cmd-palette-content` is `max-height: 60dvh` inside
`@media (max-width: 640px)`, and `dvh` shrinks when the keyboard opens, which
is the correct unit here.

**There is a trap in that file, documented at line 779: that mobile block MUST
stay BELOW the base `.cmd-palette-content` rule.** Both selectors are a single
class, so source order decides. When it sat above, the base `max-height: 80vh`
won and the `60dvh` silently never applied. Do not reorder it.

Note also that `dvh` is explicitly rejected for the hero
(`scripts/viewport-units.test.mjs`, `hero.css`) and the file already explains
why the objection does not transfer to a modal. Leave that alone too.

---

## The work

1. Replace `document.body.style.overflow` in `CommandPalette.astro` with the
   shared `modal-open` lock, matching however the video modal does it,
   including the scroll-position restore on close. Check what else keys off
   `modal-open` before you wire it up: `grain.css` hides the grain on it, and
   the note in `grain.css` says that exists for iOS Safari compositing around
   cross-origin YouTube iframes. Confirm the palette inheriting that is
   harmless (it almost certainly is) rather than assuming.
2. Add `overscroll-behavior: contain` to `.cmd-palette-results`.
3. Make sure close restores the scroll position exactly. The line-543 comment
   records a previous bug where the class was left on `<html>` and the page
   stayed locked. Test open → scroll list → close → the page is where it was.

## Hard constraints

- **Hard rule 3 in CLAUDE.md: no `overflow: hidden` on any ancestor of a
  YouTube iframe.** The palette is not one, but `modal-open` is a global class
  and the video modal IS. Verify an event page's trailer still plays after this
  change, on a real iOS device, not just in a simulator.
- `scripts/command-palette.test.mjs` and `scripts/splash-scroll-lock.test.mjs`
  both exist. Extend the first with whatever guards the new lock, and make sure
  you have not broken the second — the splash has its own scroll lock and two
  locks fighting is exactly the failure mode here.

## How to verify (must be a real phone)

An emulated viewport cannot reproduce this: the bug needs a real soft keyboard
and real touch scrolling. Desktop devtools device mode will show it working
when it is not.

1. Real iPhone, Safari. Open search, tap the input so the keyboard is up.
2. Drag the results list. The list scrolls; the page behind does not move.
3. Keep dragging past the end of the list. Still nothing behind moves.
4. Close the palette. The page is exactly where it was before opening.
5. Repeat with the keyboard dismissed.
6. Then open an event page and play the trailer, to clear hard rule 3.

## Please report back with

- Which mechanism you used for the lock and why, if it was not `modal-open`.
- Confirmation of steps 1-6 on a named device and iOS version.
- Whether anything else on the page keys off `modal-open` in a way that
  surprised you.
