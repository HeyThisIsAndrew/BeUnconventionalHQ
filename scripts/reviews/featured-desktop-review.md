# Desktop Design Review: Featured Hubs

## Assumptions
- Because no questions could be asked, I assumed the background trailer is intended to look like a seamless cinematic plate. Therefore, any visibility of native YouTube controls (play buttons, watermarks) is a failure of that illusion.
- I assumed "deck" refers to the `/featured` accordion index page.

## Coverage
All five passes were attempted. 

**Blocked Pass 5 (Adversarial Keyboard Navigation):**
I was unable to complete the keyboard navigation test because it is structurally impossible to reach the collapsed rows ("STREAMERS", "STUDIOS", "GAMING") via the `Tab` key. The accordion headers are implemented as plain `<div>` elements rather than focusable `<button>` or `<a>` tags. The focus ring skips directly from the active row's deck cards to the footer logo, completely bypassing the closed hubs.

## Findings

| What | Where | Screenshot | Severity |
| :--- | :--- | :--- | :--- |
| **Typographic Hierarchy Inversion:** The open row's label is tiny and tracked out ("THE MULTIVERSE"), while collapsed rows use massive typography ("STREAMERS"). It reads as a mistake because the active state feels less important than the inactive states. | Deck, 1440px | `hub-deck-1440.png` | Looks wrong |
| **YouTube Chrome Flashes on Loop:** At the end of the trailer's playback cycle, the video loops. For the first few seconds of the new loop, YouTube's native Play/Pause overlay and title bar flash visibly on screen before fading out again, despite the 132% crop. | Deck, 1440px | `motion-test.webm` | Breaks immersion |
| **Keyboard A11y Blocked:** Collapsed accordion rows cannot be focused or expanded using the keyboard because they are `div`s. | Deck, all viewports | `keyboard-test.mjs` | Breaks (A11y) |
| **The Hub Cliff:** Transitioning from the rich, video-backed tile on the deck to the hub page (e.g., DC Comics) results in a massive drop in production value. The hub page hero is mostly empty dark space next to the logo. | Hub Page (DC), 1440px | `dc-1440.png` | Taste / Looks wrong |

## The Opinion

Does this look like a finished product? Not quite yet. If a stranger landed on this page, they would think they were looking at a premium streaming service interface (like Netflix or Max) that is experiencing a few UI glitches. 

The core bones—the 3D deck, the accordion reveal, the staging of the artwork—are genuinely striking and ambitious. However, the illusion of premium finish shatters in the details. The typographic inversion makes the active section feel like a subtitle. The YouTube chrome flashing on every video loop breaks the cinematic fourth wall. And most importantly, clicking "Enter" feels like a bait-and-switch: you leave a lush, motion-rich deck and land in a surprisingly empty, static void on the hub page. It falls short because the "premium" feel doesn't survive the transition across pages or the lifecycle of the video.

## Suggestions

1. **Carry the Background Media into the Hub (Medium cost, High value):** Right now, the hub page feels empty. Bring the cross-fading gallery of stills (or the trailer) from the deck tile directly into the hero section of the hub page. This bridges the "cliff" and makes the transition feel seamless and earned.
2. **Fix Accordion Keyboard Navigation (Low cost, Critical value):** Change `<div class="accordion-header">` to `<button class="accordion-header">`. This instantly unblocks keyboard users and makes the page compliant.
3. **Correct the Typographic Hierarchy (Low cost, High value):** Swap the sizing logic. The open row should have the largest, boldest typography to clearly establish "You are here," while the collapsed rows should be de-emphasized. 

## What You Would Cut

**Cut the background YouTube trailer on desktop.** 
Now that you have a beautiful, cross-fading gallery of stills underneath it, the video is no longer earning its keep. The 132% crop pushes Marvel's burnt-in titling into awkward positions, and more importantly, the native YouTube UI flashes aggressively on every loop. 

What is lost? You lose the motion of the video. But what you gain is total control: the fading stills look incredibly premium, never surface third-party chrome, never buffer, and perfectly support the foreground artwork without competing with it. Cut the video and let the stills do the work.
