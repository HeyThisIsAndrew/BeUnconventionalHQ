import('lighthouse').then(async ({ default: lighthouse }) => {
  const chromeLauncher = await import('chrome-launcher');
  const fs = require('fs');
  
  const chrome = await chromeLauncher.launch({chromeFlags: ['--headless']});
  const options = {logLevel: 'info', output: 'json', onlyCategories: ['performance', 'accessibility'], port: chrome.port};
  const runnerResult = await lighthouse('http://localhost:4323/', options);

  const perfScore = runnerResult.lhr.categories.performance.score * 100;
  const a11yScore = runnerResult.lhr.categories.accessibility.score * 100;
  
  console.log(`Lighthouse Performance Score: ${perfScore}%`);
  console.log(`Lighthouse Accessibility Score: ${a11yScore}%`);
  
  const report = `\nLighthouse Audit:\n- Performance: ${perfScore}%\n- Accessibility: ${a11yScore}%\n`;
  fs.appendFileSync('VERIFIED_QA_RESULTS.md', report);

  await chrome.kill();
  
  if (perfScore < 90 || a11yScore < 100) {
    console.error('Lighthouse scores did not meet mandate!');
    process.exit(1);
  } else {
    console.log('✅ Lighthouse Mandate Passed.');
  }
});
