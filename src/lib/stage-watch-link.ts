/**
 * ─── ONE WIRING FOR THE EVENT AND HUB STAGES' ESCAPE LINK ──────────────────
 *
 * `/featured/[slug]`, EventFeatured and EventAnnouncement each carry a stage
 * that plays a trailer, and each was missed when the escape hatch was added to
 * the /feed hero and the card lightbox. The reader trapped by a YouTube
 * sign-in wall could have been on any of them.
 *
 * The three files are already near-identical triplets. CLAUDE.md records what
 * that costs over and over: two tag lists that drifted, two hero lockups that
 * had to be guarded in one test file, a fix that landed in one of two players
 * and looked finished. So the behaviour lives HERE, once, and those three
 * files carry only the markup plus the video id they already had in hand.
 *
 * ─── HOW IT KNOWS WHAT IS PLAYING ──────────────────────────────────────────
 *
 * Those stages already dispatch `hub:sourcechange` on themselves every time
 * they assign the frame a src. This listens for that and reads the id back off
 * THE FRAME, rather than off the event's detail.
 *
 * That is the whole reason it covers everything. There are FOUR such
 * assignments in each of the three files, not the two an obvious reading
 * finds: the ambient trailer that starts itself, its muted retry when the
 * browser refuses sound, the pressed-play path, and ITS muted retry. Threading
 * an id through the detail of all twelve is twelve chances to miss one, and
 * the ambient pair does not even have an id in scope. It holds a `data-src`.
 * The frame always knows what it is playing.
 *
 * `parseVideoId()` does the reading, per the codebase rule that ids are never
 * parsed by hand. It did not recognise a `youtube-nocookie.com/embed/` URL
 * until this landed, which is every embed the site actually serves.
 *
 * Delegated from the document and bound once, so it covers stages that arrive
 * with a client-side navigation without re-binding per page.
 */
import { parseVideoId } from './platforms/youtube.ts';

/** The escape link inside a given stage, if that stage has one. */
function linkFor(stage: Element): HTMLAnchorElement | null {
  return stage.querySelector<HTMLAnchorElement>('.hub-stage-watch');
}

export function initStageWatchLink() {
  if ((window as any).__hqStageWatchBound) return;
  (window as any).__hqStageWatchBound = true;

  /*
    `hub:sourcechange` is dispatched on the stage element and does not bubble
    in the three callers, so this listens in the CAPTURE phase at the document,
    which sees it on the way down regardless.
  */
  document.addEventListener(
    'hub:sourcechange',
    (event: Event) => {
      const stage = event.target as Element | null;
      if (!stage || !(stage instanceof Element)) return;

      const link = linkFor(stage);
      if (!link) return;

      /*
        The frame is the source of truth. `about:blank` and a src the parser
        does not recognise both yield null, which correctly leaves the link
        hidden: there is nothing to point it at.
      */
      const frame = stage.querySelector<HTMLIFrameElement>('.hub-stage-iframe');
      const videoId = parseVideoId(frame?.src ?? null);
      if (!videoId) {
        link.hidden = true;
        return;
      }

      /*
        encodeURIComponent, not the raw id: these come from `data-hub-play`,
        which is filled from content, and a watch URL is a link this page hands
        a visitor.
      */
      link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
      link.hidden = false;
    },
    true,
  );
}
