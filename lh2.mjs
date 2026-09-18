import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

(async () => {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  const options = {logLevel: 'error', output: 'json', onlyCategories: ['performance'], port: chrome.port, formFactor: 'mobile', screenEmulation: {mobile: true}};
  const runnerResult = await lighthouse('https://beunconventionalhq.com/', options);
  const reportJson = JSON.parse(runnerResult.report);
  
  const lcpElement = reportJson.audits['largest-contentful-paint-element'];
  console.log('LCP Element Details:', JSON.stringify(lcpElement, null, 2));
  
  await chrome.kill();
})();
