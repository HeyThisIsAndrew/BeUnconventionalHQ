import { XMLParser } from 'fast-xml-parser';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <entry>
  <id>yt:video:b6uTSRStZQ0</id>
  <yt:videoId>b6uTSRStZQ0</yt:videoId>
  <title>Spider-Noir</title>
  <link rel="alternate" href="https://www.youtube.com/shorts/b6uTSRStZQ0"/>
 </entry>
 <entry>
  <id>yt:video:abc</id>
  <yt:videoId>abc</yt:videoId>
  <title>Normal video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc"/>
 </entry>
</feed>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
});
const feed = parser.parse(xml);
console.log(JSON.stringify(feed.feed.entry, null, 2));
