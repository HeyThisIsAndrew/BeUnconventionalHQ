import { getVideosUnified } from './src/lib/videos-source.ts';

const catLabel = 'film';
function matchesCategory(item) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const cat = item.category || 'general';
  const allTags = [...tags, cat].map(t => typeof t === 'string' ? t.toLowerCase().trim() : '');
  
  return allTags.some(t => {
    if (t === catLabel) return true;
    if (catLabel === 'events' && t === 'event') return true;
    if (catLabel === 'event' && t === 'events') return true;
    return false;
  });
}

async function run() {
  const allVideos = await getVideosUnified();
  
  const filmVideos = allVideos.filter(matchesCategory);
  
  console.log("\n--- Top 4 Film Videos (what shows on hub) ---");
  filmVideos.slice(0, 4).forEach(v => console.log(`- ${v.title} (${v.date})`));
  
  console.log("\n--- Next 10 Film Videos (hidden by slice) ---");
  filmVideos.slice(4, 14).forEach(v => console.log(`- ${v.title} (${v.date})`));
}

run().catch(console.error);
