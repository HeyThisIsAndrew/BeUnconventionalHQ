/**
 * REFERRAL & GEAR LINKS — the single source of truth.
 *
 * ─── WHAT THIS IS FOR ─────────────────────────────────────────────────────
 * Be Unconventional HQ is self-funded. These links are how that works: they
 * cost the reader nothing and they pay for the coverage. The plan is for this
 * list to keep growing, so it lives in ONE file rather than being retyped
 * into every surface that shows it — the article side rail today, and
 * whatever comes next (a /support page, the YouTube description block) later.
 *
 * Add a partner here and it appears everywhere. Never paste a referral URL
 * into a component.
 *
 * ─── HOW TO ADD A PARTNER ─────────────────────────────────────────────────
 *   1. pick the group it belongs to (or add a new one);
 *   2. add an entry with `label`, `href`, `blurb` and an `icon` key from
 *      BRAND_ICONS in src/data/icons.js;
 *   3. that's it. An entry with an empty `href` is SKIPPED automatically, so
 *      you can stub out a partnership before it is signed without ever
 *      shipping a dead link.
 *
 * ─── FIELDS ───────────────────────────────────────────────────────────────
 *   label     what the link is called. Keep it short — it sits in a narrow
 *             rail.
 *   href      the tagged referral / affiliate URL.
 *   blurb     one line on why it is here. Write it honestly; every one of
 *             these is something actually in use.
 *   icon      a key from BRAND_ICONS (src/data/icons.js).
 *   offer     OPTIONAL. A concrete incentive for the reader ("$15 renewal
 *             credit"). Rendered as a highlighted tag, so use it only when
 *             the reader genuinely gets something — not as a sales line.
 *   affiliate OPTIONAL, defaults true. Set false for a link that pays us
 *             nothing, so the disclosure below stays accurate.
 *
 * ─── THE DISCLOSURE IS NOT OPTIONAL ───────────────────────────────────────
 * US FTC guidance requires affiliate relationships to be disclosed clearly
 * and near the links. REFERRAL_DISCLOSURE is rendered above every list.
 * Do not remove it, and do not move it below the links.
 */
import { site } from './site.js';

/**
 * One partner link.
 *
 * Declared as JSDoc rather than a TypeScript interface so this stays a plain
 * .js data file — the same pattern site.js and content.js use — while
 * `astro check` still catches a typo in a field name or a missing `href`.
 *
 * @typedef {object} ReferralItem
 * @property {string}  label      short display name
 * @property {string}  href       the tagged referral / affiliate URL
 * @property {string}  blurb      one honest line on why it is here
 * @property {string}  icon       a key from BRAND_ICONS (src/data/icons.js)
 * @property {string}  [offer]    concrete reader incentive, e.g. "$15 credit"
 * @property {boolean} [affiliate] false when the link pays us nothing
 *
 * @typedef {object} ReferralGroup
 * @property {string} id
 * @property {string} title
 * @property {string} [note]
 * @property {ReferralItem[]} items
 */

export const REFERRAL_DISCLOSURE =
  'Self-funded and independent. Some links below are affiliate or referral links — using them costs you nothing and helps fund coverage.';

/** Heading for the whole block, wherever it is rendered. */
export const REFERRAL_HEADING = 'Support The HQ';

/** Sub-heading used when the block needs a sentence of context. */
export const REFERRAL_INTRO = 'Referral & gear links';

/** @type {ReferralGroup[]} */
export const REFERRAL_GROUPS = [
  {
    id: 'launchpad',
    title: 'The HQ Launchpad',
    /* Group-level context. One line — the rail is narrow. */
    note: 'Cross-curated collections for desk setups, gaming spaces and shelves.',
    items: [
      {
        label: 'Amazon Storefront',
        /* Read from site.js so the storefront URL has exactly one home — the
           footer's social row already links to the same value. */
        href: site.socials.amazon,
        blurb: 'Desk upgrades, 4K Blu-rays and the lore books worth owning.',
        icon: 'amazon',
      },
    ],
  },
  {
    id: 'everyday',
    title: 'What We Actually Use',
    note: 'Services running in the background of every shoot.',
    items: [
      {
        label: 'Mint Mobile',
        href: 'https://my.mintmobile.com/refer/pHvGFQz',
        blurb: 'The wireless plan that keeps on-location coverage affordable.',
        offer: '$15 renewal credit',
        icon: 'signal',
      },
    ],
  },
  {
    id: 'gear',
    title: 'Cinematic Filming Gear',
    note: 'The exact kit behind the deep dives.',
    items: [
      {
        label: 'Sony A7 IV',
        href: 'https://amzn.to/3RAmcEy',
        blurb: 'Primary cinema camera.',
        icon: 'aperture',
      },
      {
        label: 'Sony A7C R',
        href: 'https://amzn.to/4dWoUeT',
        blurb: 'B-roll and second body.',
        icon: 'camera',
      },
      {
        label: 'Moment',
        href: 'https://partner.shopmoment.com/Ao14xD',
        blurb: 'Mobile lenses and filtration.',
        icon: 'aperture',
      },
    ],
  },
  {
    id: 'software',
    title: 'The Software Stack',
    note: 'Post-production and live streaming.',
    items: [
      {
        label: 'DaVinci Resolve',
        href: 'https://www.blackmagicdesign.com/products/davinciresolve',
        blurb: 'Colour and edit.',
        icon: 'colorWheel',
        /* Blackmagic runs no affiliate programme — this is a straight
           recommendation, and the flag keeps the disclosure truthful. */
        affiliate: false,
      },
      {
        label: 'Adobe Lightroom & Photoshop',
        href: 'https://www.adobe.com',
        blurb: 'Thumbnails and visual assets.',
        icon: 'layers',
        affiliate: false,
      },
      {
        label: 'OBS Studio',
        href: 'https://obsproject.com',
        blurb: 'High-bitrate streaming and capture.',
        icon: 'broadcast',
        affiliate: false,
      },
    ],
  },
];

/**
 * The groups, with unfinished entries removed.
 *
 * Call THIS from components, never REFERRAL_GROUPS directly — it is what
 * guarantees a partner stubbed out with an empty `href` can never render as a
 * link to nowhere. A group left with no usable items disappears entirely
 * rather than rendering an empty heading.
 *
 * @returns {ReferralGroup[]}
 */
export function getReferralGroups() {
  return REFERRAL_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => Boolean(item.href)),
  })).filter((group) => group.items.length > 0);
}

/** Every live referral as one flat list, for surfaces without groups. */
export function getReferralItems() {
  return getReferralGroups().flatMap((group) => group.items);
}

/**
 * `rel` for a referral link.
 *
 * `sponsored` tells search engines the link is commercial, which is what
 * Google asks for on affiliate links — omitting it risks the link being read
 * as an editorial endorsement passing ranking signal. A non-affiliate
 * recommendation gets plain `noopener noreferrer`, because calling it
 * sponsored when it isn't would be its own kind of inaccuracy.
 *
 * @param {ReferralItem} item
 * @returns {string}
 */
export function referralRel(item) {
  return item.affiliate === false
    ? 'noopener noreferrer'
    : 'noopener noreferrer sponsored';
}
