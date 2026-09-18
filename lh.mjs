import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

(async () => {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  const options = {logLevel: 'error', output: 'json', onlyCategories: ['performance'], port: chrome.port, formFactor: 'mobile', screenEmulation: {mobile: true}};
  const runnerResult = await lighthouse('https://beunconventionalhq.com/', options);
  const reportJson = JSON.parse(runnerResult.report);
  
  console.log('Score:', reportJson.categories.performance.score * 100);
  console.log('LCP:', reportJson.audits['largest-contentful-paint'].displayValue);
  console.log('CLS:', reportJson.audits['cumulative-layout-shift'].displayValue);
  console.log('FCP:', reportJson.audits['first-contentful-paint'].displayValue);
  
  console.log('LCP Element Details:', JSON.stringify(reportJson.audits['largest-contentful-paint-element'], null, 2));
  
  const audits = reportJson.audits;
  for (const key of Object.keys(audits)) {
    if (audits[key].score !== null && audits[key].score < 0.9) {
      console.log(`Failed Audit: ${key} (${audits[key].score})`);
    }
  }
  
  await chrome.kill();
})();
