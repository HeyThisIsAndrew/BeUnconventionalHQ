# iOS Safari Video Playback - Root Cause Analysis & Handoff

**Status:** The "Eager Command Broadcasting" fix (synchronous postMessage) has been implemented but the bug persists. Further investigation and testing required.

---

## What Was Attempted

### The Fix Applied
Modified `initTrailer()` in [src/pages/events-new/[slug].astro](src/pages/events-new/[slug].astro) to remove the async queue system:

**Old approach (failed):**
```javascript
const command = (func, args = []) => {
  const payload = { event: 'command', func, args };
  if (ready) post(payload);
  else queue.push(payload);
};

// Later, when onReady fires:
if ((data.event === 'onReady' || data.event === 'initialDelivery') && !ready) {
  ready = true;
  queue.splice(0).forEach(post); // ❌ Async flushing = gesture expired
}
```

**New approach (still failing):**
```javascript
const command = (func, args = []) => {
  const payload = { event: 'command', func, args };
  post(payload); // ✅ Send immediately, synchronously
};

// Track pending state:
let pendingPlayback = false;
let pendingVolume = 100;

poster.addEventListener('click', () => {
  pendingPlayback = true;
  pendingVolume = 100;
  command('playVideo');      // Synchronous send within gesture
  command('unMute');         // Synchronous send within gesture
  command('setVolume', [100]); // Synchronous send within gesture
  setMuted(false);
  hidePoster();
});
```

**Rationale:** Commands sent synchronously within the click event should preserve iOS Safari's gesture context, allowing unmute to be treated as user-initiated rather than script-initiated.

**Result:** Still broken. Video still goes black, unmute still fails.

---

## Root Cause Analysis: Why It's Still Failing

### 1. postMessage Does Not Propagate Gesture Context Across Origin Boundaries

**Hypothesis:** iOS Safari's media gesture enforcement may be tied to **DOM events on the user's tapped element**, not to the synchronicity of the JavaScript executing in the tapping document.

Even though the `postMessage` command is sent synchronously within the click handler, it crosses into a **cross-origin iframe** (YouTube). iOS Safari likely does not recognize this as "the user gestured on the video player element"—it recognizes it as "a script in a different origin sent a message."

**Evidence:**
- The muted autoplay (`autoplay=1&mute=1` in the URL) works reliably, eventually playing the video with sound off
- This works because URL parameters are parsed by the browser *before* JavaScript execution, and before cross-origin boundaries matter
- They're "page load parameters," not script-initiated commands
- Muted video doesn't require gesture context (it's already muted), so it's allowed even on reload

**Implication:** The gesture context may be **sandboxed to the origin it originated from**, and postMessage to a cross-origin iframe breaks that link.

### 2. YouTube's postMessage API May Not Accept Commands Until a Specific Lifecycle Point

**Hypothesis:** The `onReady` event signals "the player iframe loaded," but the YouTube API may not be ready to accept **state-changing commands** (unmute, volume) until:
- The player has completed its internal initialization beyond just loading the HTML
- A user gesture has directly targeted the YouTube element (which postMessage doesn't provide)
- The player enters a specific state in its lifecycle

**Evidence:**
- `onReady` fires, but subsequent commands are silently dropped
- The poster overlay removal happens immediately (the DOM manipulation works)
- But the video doesn't start playing with sound, suggesting the API call was ignored
- The eventual muted playback via native autoplay suggests the iframe works; only postMessage control fails

**Implication:** postMessage might not be the right API for this use case on iOS Safari, even with correct timing.

### 3. iOS Safari May Block Cross-Origin postMessage Commands for Media Control

**Hypothesis:** iOS Safari applies additional restrictions to postMessage for security reasons:
- Allows cross-origin postMessage for basic communication (messaging, data passing)
- **Blocks** cross-origin postMessage for sensitive operations (media control, fullscreen, camera access)
- This is more restrictive than desktop Safari or Chrome

**Evidence:**
- The same postMessage-based approach works on desktop browsers
- iOS Safari's stricter media policies (low-power mode, battery saver, autoplay restrictions) are well-documented
- Cross-origin postMessage for media would be a privilege escalation vector

**Implication:** postMessage to control YouTube playback may be architecturally blocked on iOS Safari at the browser level.

---

## Timeline of Failure

```
T=0ms:     User taps poster button
           └─ Click handler fires (gesture context ALIVE ✅)

T=1ms:     postMessage('playVideo') sent synchronously
           └─ Still within gesture, but crosses origin boundary
           └─ iOS Safari may not recognize this as gesture-driven

T=2ms:     postMessage('unMute') sent synchronously
           └─ Same cross-origin boundary issue

T=3ms:     hidePoster() executed
           └─ Poster overlay removed immediately
           └─ Screen shows black iframe (video not yet playing)

T=500-2000ms: YouTube iframe finishes loading
           └─ onReady event fires
           └─ We resend postMessage commands (pointless, still cross-origin)

T=2000ms+: Native autoplay=1&mute=1 finally processes
           └─ Video plays muted (the only state that works)
           └─ User sees video but hears no audio

T=refresh: Safari gets more aggressive about autoplay
           └─ Even muted autoplay may be blocked
           └─ Video refuses to play entirely
```

---

## Recommended Solutions

### Solution A: Remove Custom Poster, Use Native YouTube Controls (Highest Confidence)

**Implementation:**
- Delete `.trailer-poster-overlay` and custom play button
- Remove the poster hiding logic entirely
- Render the iframe with `controls=1` instead of `controls=0`
- Let YouTube's native UI handle play/pause/unmute

**Pros:**
- YouTube's native controls are explicitly designed for iOS Safari compliance
- Users recognize the standard interface
- No postMessage needed; no gesture context required for unmute (users tap YouTube's own button)
- Bulletproof reliability

**Cons:**
- Loses custom branding/design
- Standard YouTube UI instead of custom trailer design

**Confidence Level:** 95% — This is the recommended approach by YouTube themselves for mobile.

---

### Solution B: Delay Poster Hiding Until Confirmed Playback (Medium Confidence)

**Implementation:**
```javascript
let userRequestedPlay = false;

poster.addEventListener('click', () => {
  userRequestedPlay = true;
  command('playVideo');
  command('unMute');
  command('setVolume', [100]);
  // DON'T hide poster yet
});

// Only hide poster after onReady AND we confirm unmute succeeded:
if (state === 1 && data.info.muted === false) {
  hidePoster(); // Hide when we're confident video is playing with sound
}

// Or if video plays muted after timeout (fallback):
setTimeout(() => {
  if (state === 1 && posterHidden === false) {
    hidePoster(); // Give up and show the muted video
  }
}, 3000);
```

**Pros:**
- Keeps custom design intact
- Poster acts as visual feedback: "I'm trying to load"
- If unmute fails, user still sees the poster (knows something went wrong)
- Low risk—just delays hiding, doesn't change API calls

**Cons:**
- Still relies on postMessage (which may not work)
- User sees poster for 1-3 seconds even on success (less snappy)
- If unmute fails silently, poster stays up indefinitely (poor UX)

**Confidence Level:** 40% — Unlikely to fix the root cause, but improves UX during failure.

---

### Solution C: Change iframe src on Click Instead of postMessage (Low-Medium Confidence)

**Implementation:**
```javascript
const originalSrc = iframe.src.replace('mute=1', 'mute=0').replace('autoplay=1', 'autoplay=1');

poster.addEventListener('click', () => {
  // Change the src to unmute version; this forces a reload with new parameters
  iframe.src = originalSrc + '&t=' + Date.now(); // Cache bust to force reload
  hidePoster();
});
```

**Pros:**
- URL parameters (`mute=0`) are browser primitives, not script-initiated commands
- May be treated as more "trusted" than postMessage
- Might avoid the cross-origin restriction

**Cons:**
- iframe reloads visibly (flicker, 500-2000ms delay)
- User sees black screen, then video reappears (jarring)
- Still crosses origin boundary (might get blocked)
- Loses poster design during reload

**Confidence Level:** 35% — Speculative; URL parameter handling may face same restrictions.

---

### Solution D: Use Vimeo or Self-Hosted Video (Highest Confidence for Control)

**Implementation:**
- Replace YouTube iframe with Vimeo iframe (better mobile API) or self-hosted `<video>` tag
- Vimeo's player.js or native HTML5 video gives direct control over unmute/play

**Pros:**
- Complete control over player API
- No cross-origin postMessage issues
- Vimeo is explicitly optimized for mobile playback
- HTML5 `<video>` is native, works everywhere

**Cons:**
- Requires migrating away from YouTube
- May lose YouTube-specific features (recommendations, analytics)
- Self-hosted video requires CDN/streaming infrastructure

**Confidence Level:** 90% — Would definitely work, but architectural change.

---

## Recommended Path Forward

**Primary:** Implement **Solution A** (native YouTube controls). Test on iOS Safari to confirm unmute works.
- If this works: Keep it. Custom design was the problem; native is the solution.
- If this fails: YouTube itself has a platform-level issue with iOS Safari unmute (unlikely, but possible).

**Secondary:** If native controls don't work, implement **Solution C** (change src on click) as a fallback.

**Tertiary:** If nothing works, evaluate **Solution D** (Vimeo or self-hosted).

**Not recommended:** Solution B alone—it masks the problem without fixing it.

---

## Testing Checklist for Antigravity

- [ ] Test Solution A (native controls) on iOS Safari 17+ with fresh device state (Low Power Mode off)
- [ ] Test with network throttling (3G) to observe poster timing
- [ ] Test refresh behavior (does video autoplay the second time?)
- [ ] Test on iOS Firefox (uses Safari engine; should show same behavior)
- [ ] Verify desktop/Android behavior unchanged after any fix

---

## Questions for User

Before implementing a solution, clarify:
1. **Must the custom poster design be preserved?** (Determines if we pursue Solutions B/C or just use native)
2. **Is the black screen phase the only problem, or is unmute also completely silent?** (Affects which API is failing)
3. **Can we migrate to Vimeo/self-hosted if YouTube fundamentally doesn't work?** (Scope bounds)
4. **How many users are affected?** (iOS vs. cross-platform priority)
