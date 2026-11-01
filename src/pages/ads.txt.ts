/**
 * /ads.txt — the list of companies authorised to sell ads on this site.
 *
 * Driven by ONE setting, `site.adsensePublisherId` (src/data/site.js). Until
 * it is set, the file says no seller is authorised, which is true while no ads
 * run, and an ads.txt with only comments is valid. Once it is set, the build
 * writes Google's line for that account, in the exact form AdSense asks for:
 *
 *   google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
 *
 * `f08c47fec0942fa0` is Google's fixed certification authority ID, the same
 * for every AdSense account. Built statically, like every page here.
 */
import { site } from '../data/site.js';

/** The ads.txt body for a publisher ID as AdSense shows it ("ca-pub-…"), or '' for none. */
export function adsTxt(publisherId: string): string {
  const pub = String(publisherId ?? '').trim().replace(/^ca-/, '');
  if (!/^pub-\d{10,20}$/.test(pub)) {
    return '# BE Unconventional HQ: no authorised ad sellers yet.\n# Set adsensePublisherId in src/data/site.js once the AdSense account exists.\n';
  }
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}

export function GET(): Response {
  return new Response(adsTxt(site.adsensePublisherId), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
