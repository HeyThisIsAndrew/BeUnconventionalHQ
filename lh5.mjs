import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import fs from 'fs';

(async () => {
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  const options = {logLevel: 'error', output: 'json', onlyCategories: ['performance'], port: chrome.port, formFactor: 'mobile', screenEmulation: {mobile: true}};
  const runnerResult = await lighthouse('https://beunconventionalhq.com/', options);
  
  fs.writeFileSync('lh-report.json', runnerResult.report);
  
  await chrome.kill();
})();
