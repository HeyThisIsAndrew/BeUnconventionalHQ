import fs from 'fs';
const data = JSON.parse(fs.readFileSync('.lighthouse-reports/_feed.json', 'utf8'));
console.log(JSON.stringify(data.audits['largest-contentful-paint-element'].details, null, 2));
