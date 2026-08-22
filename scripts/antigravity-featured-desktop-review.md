# Antigravity brief — /featured desktop design review (READ-ONLY)

## What this is

A design critique of the Featured Hubs page and the hub pages it leads to, on
**desktop only**. You are assessing, not building.

## Hard constraints

1. **Make no changes.** No edits, no commits, no branches, no PRs, no pushes.
   If you think something needs fixing, describe it — do not fix it.
2. **Desktop only.** 1440x900, 1728x1117 and 2560x1440. Ignore phones and
   tablets entirely; portrait and landscape mobile were reworked separately
   and are out of scope for this pass. A finding that only reproduces below
   1024px wide is out of scope — drop it.
3. **Judge what is there, not what you would have built.** The 3D deck, the
   accordion rows and the four fixed categories are settled decisions. Do not
   propose replacing them with a grid, a carousel, tabs, or a scroll-jacked
   full-screen pager. Improvements go *inside* this design.
4. **Report only what you can point at.** Every finding needs a screenshot, a
   viewport size, and the hub or row it happened on.

## Where

Preview: `https://claude-featured-hubs-accordion-mtiyzo-beunconventionalhq.heythisisandrewb.workers.dev/featured`

Branch: `claude/featured-hubs-accordion-mtiyzo` (PR #141). The identical page
is on `feature/featured-section-labels`; the two are kept in sync, review
either.

Also in scope: the hub pages the tiles lead to — `/featured/marvel`,
`/featured/dc-comics`, `/featured/netflix`, `/featured/playstation`.

## Already known — do not report these as discoveries

- **13 of the 15 hubs have no logo and no hero image.** They fall back to the
  Be Unconventional mark, and their rail thumbnails render as text boxes.
  Only Marvel and DC have real artwork. This is a content gap, not a bug.
  You may comment on *how the design behaves* when art is missing; do not
  file "PlayStation has no image" as a finding.
- The typeface picker in the bottom-right is a temporary dev-only control and
  does not ship. Production is Montserrat Medium.
- Clicking a category header plays a low bass thud. Its future is undecided.
- `/featured` scores 93% on the Lighthouse gate (threshold 90).

## What just changed, so you review the current state and not the last one

- The brand logo, the one-line description and the way in have moved off the
  trailer and **onto the key art tile**, bottom-left, with an "Enter" chip in
  the opposite corner. The tile itself is now the link.
- The trailer is now a background plate with nothing readable on it.
- The trailer no longer overhangs its row onto the footer.
- The hub rail no longer dims its first and last item.
- The typeface picker now actually works on desktop (it was scoped to a phone
  media query and did nothing above 768px).

## Swarm

Run these as separate passes and keep their findings separate. Do not let one
pass rewrite another's conclusions — where two disagree, report both and say
so.

### 1. Composition
Open each of the four rows. For each: where does the eye land first, second,
third? Is that the intended order? Specifically —
- The tile carries the logo, the line and the chip. Is that corner crowded, or
  is it the billing block it is meant to be?
- Does the trailer half now feel purposeful, or does it read as empty space
  that used to have something in it?
- Is the balance between the two halves right at 2560px, where the row gets
  very wide and very short?
- The open row's own category label is the *smallest* text on screen while the
  collapsed rows below it are large. Is that inversion working as "you are
  here, those are elsewhere", or does it just look like a mistake?

### 2. Motion and timing
- Open and close each row several times. The reveal is staged: artwork, rail,
  mark, chip. Is the sequence readable, or does it feel slow on a second view?
- The trailer pushes in over 32 seconds. Watch a full cycle. Too much, too
  little, or unnoticeable in the right way?
- The backlight tracks the pointer. Does it read as depth or as wobble?
- Anything that moves when it should be still, or lands after you have already
  looked at it.

### 3. Trailer content
This is the one I most want an outside opinion on. The trailers are real
YouTube embeds, muted, controls hidden.
- Marvel's has burnt-in titling ("DOOMSDAY IS COMING" and a countdown) baked
  into the video. It is now behind the artwork rather than under the text, but
  is it still fighting? Check every hub that has a trailer.
- Does YouTube's own chrome ever surface — an end screen, a title card, a
  paused state, a "More videos" grid? Leave a row open for five minutes and
  watch what the embed does when the video ends.
- Would a short silent loop of a single shot serve this better than a full
  trailer? Say yes or no and why.

### 4. The cliff into a hub page
Click into `/featured/marvel` from the deck.
- Describe the drop in production value in specific terms: what does the hub
  page do differently from the page you just left?
- Which two or three changes would close most of that gap without rebuilding
  the hub page from scratch?
- Rank them by how much they buy per unit of work.

### 5. Adversarial
- Resize slowly from 1024px to 2560px. Anything that overlaps, clips, escapes
  its row, or lands on the footer.
- Tab through the page with the keyboard only. Can you reach and enter every
  hub? Is the focus ring visible on the artwork?
- Open a row, scroll the hub rail, then open a different row and come back.
- Leave the page open for ten minutes and come back.
- Browser zoom at 150% and 200%.
- Open every row in turn, quickly, without waiting for animations to finish.

## Output

One markdown report. No code, no diffs, no patches.

- **Findings** — table: what, where (hub + row + viewport), screenshot,
  severity (breaks / looks wrong / taste).
- **The opinion** — half a page, plain language. Does this look like a
  finished product? If a stranger landed here, what would they think it was?
  Where does it fall short of that?
- **Suggestions** — ranked, each with what it would cost and what it would
  buy. Say which single change you would make first.
- **What you would cut.** At least one thing. This page has accreted parts and
  I want an outside view on which of them are not earning their place.

Be direct. "It looks good" is not useful; if something works, say what makes
it work so it can be kept when the rest changes.
