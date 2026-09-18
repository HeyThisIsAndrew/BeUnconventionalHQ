import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

(async () => {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  const options = {logLevel: 'error', output: 'json', onlyCategories: ['performance'], port: chrome.port, formFactor: 'mobile', screenEmulation: {mobile: true}};
  const runnerResult = await lighthouse('https://beunconventionalhq.com/', options);
  const reportJson = JSON.parse(runnerResult.report);
  
  const audits = reportJson.audits;
  console.log('LCP Audit:', JSON.stringify(audits['largest-contentful-paint'], null, 2));
  
  // Find which audit has the node
  const withNode = Object.keys(audits).filter(k => audits[k].details && audits[k].details.items && audits[k].details.items.some(i => i.node));
  console.log('Audits with nodes:', withNode);
  if (withNode.includes('lcp-lazy-loaded')) {
    console.log('lcp-lazy-loaded details:', JSON.stringify(audits['lcp-lazy-loaded'], null, 2));
  }
  
  await chrome.kill();
})();
