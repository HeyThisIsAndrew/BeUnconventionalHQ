/**
 * The newsletter page's accordions (/newsletter): the topics strip inside
 * the subscribe form (NewsletterTopics variant="accordion") and the
 * "Already subscribed?" strip. Markup and look are /featured's accordion
 * (`.accordion-section` / `.accordion-heading` > `.accordion-header`,
 * styled under `.nl-acc` in newsletter.css). Unlike /featured, each strip
 * opens and closes ON ITS OWN: opening one never closes the other (owner's
 * call, 2026-11-01).
 */

/** Open or close one strip, keeping its button's aria-expanded in step. */
export function setAccordion(section: HTMLElement, open: boolean): void {
  section.classList.toggle('expanded', open);
  section.classList.toggle('collapsed', !open);
  section.querySelector('.accordion-header')?.setAttribute('aria-expanded', String(open));
}

/** Wire one strip's header to toggle it. Safe to call more than once. */
export function bindAccordion(section: HTMLElement): void {
  if (section.dataset.accordionBound) return;
  section.dataset.accordionBound = '1';
  section.querySelector('.accordion-header')?.addEventListener('click', () => {
    setAccordion(section, !section.classList.contains('expanded'));
  });
}
