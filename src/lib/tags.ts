export function getDisplayTags(item: any): string[] {
  let explicitTokens: string[] = [];
  
  if (Array.isArray(item.youtubeTags)) explicitTokens.push(...item.youtubeTags);
  if (Array.isArray(item.tags)) explicitTokens.push(...item.tags);

  let cleanTokens = explicitTokens.map(t => typeof t === 'string' ? t.replace(/[#@\s]/g, '').toUpperCase() : '');
  cleanTokens = [...new Set(cleanTokens.filter(Boolean))];

  let tag1 = '';
  const brandMap = [
    { label: 'MARVEL', regex: /MARVEL|WOLVERINE|AVENGERS|SPIDER|XMEN|MCU|DEADPOOL|VENOM/ },
    { label: 'DC', regex: /DC$|DCU|BATMAN|SUPERMAN|WONDERWOMAN|JUSTICELEAGUE|JOKER|LANTERNS/ },
    { label: 'NETFLIX', regex: /NETFLIX/ },
    { label: 'APPLE TV+', regex: /APPLE/ },
    { label: 'DISNEY', regex: /DISNEY/ },
    { label: 'PLAYSTATION', regex: /\bSONY\b|SONYPICTURES|PLAYSTATION|PS5|PS4/ },
    { label: 'WARNER BROS', regex: /WARNER|WB/ },
    { label: 'HBO', regex: /HBO|^MAX$|HBOMAX/ },
    { label: 'UNIVERSAL PICTURES', regex: /UNIVERSAL/ },
    { label: '20TH CENTURY', regex: /20TH/ },
    { label: 'ANIMATION', regex: /ANIMATION/ },
    { label: 'PRIME VIDEO', regex: /PRIME|AMAZON|THEBOYS/ },
    { label: 'HULU', regex: /HULU/ },
    { label: 'NINTENDO', regex: /NINTENDO|SWITCH|ZELDA|MARIO/ },
    { label: 'XBOX', regex: /XBOX|HALO|GEARS/ },
    { label: 'STAR WARS', regex: /STARWARS|JEDI/ },
    { label: 'INSOMNIAC', regex: /INSOMNIAC/ },
    { label: 'LIONSGATE', regex: /LIONSGATE/ },
    { label: 'A24', regex: /^A24/ },
    { label: 'PARAMOUNT', regex: /PARAMOUNT/ }
  ];

  for (const b of brandMap) {
    if (cleanTokens.some(t => b.regex.test(t))) {
      tag1 = b.label;
      break;
    }
  }

  let tag2 = '';
  const typeMap = [
    { label: 'REVIEW', regex: /REVIEW/ },
    { label: 'COMMENTARY', regex: /COMMENTARY/ },
    { label: 'TRAILER', regex: /TRAILER/ },
    { label: 'ANALYSIS', regex: /ANALYSIS|DEEPDIVE/ },
    { label: 'BREAKDOWN', regex: /BREAKDOWN/ },
    { label: 'PODCAST', regex: /PODCAST/ },
    { label: 'PREMIERE', regex: /PREMIERE/ },
    { label: 'REACTION', regex: /REACTION/ },
    { label: 'INTERVIEW', regex: /INTERVIEW/ },
    { label: 'NEWS', regex: /NEWS/ },
    { label: 'ANNOUNCEMENT', regex: /ANNOUNCEMENT/ }
  ];

  for (const type of typeMap) {
    if (cleanTokens.some(t => type.regex.test(t)) || (item.contentType && type.regex.test(item.contentType.toUpperCase()))) {
      tag2 = type.label;
      break;
    }
  }

  let tag3 = '';
  const eventMap = [
    { label: 'SDCC', regex: /SDCC|COMICCON/ },
    { label: 'CONVENTION', regex: /^CONVENTIONS?$|WONDERCON/ },
    { label: 'D23', regex: /D23/ },
    { label: 'E3', regex: /E3/ },
    { label: 'GAMESCOM', regex: /GAMESCOM/ },
    { label: 'SUMMER GAME FEST', regex: /SGF|SUMMERGAMEFEST/ },
    { label: 'THE GAME AWARDS', regex: /TGA|GAMEAWARDS/ },
    { label: 'PAX', regex: /PAX/ },
    { label: 'GDC', regex: /GDC/ },
    { label: 'DC FANDOME', regex: /FANDOME/ },
    { label: 'PREMIERE', regex: /PREMIERE/ }
  ];

  for (const e of eventMap) {
    if (tag2 === e.label) continue;
    if (cleanTokens.some(t => e.regex.test(t))) {
      tag3 = e.label;
      break;
    }
  }

  let unusedTokens = cleanTokens.filter(t => {
    const used1 = tag1 ? tag1.replace(/\s/g, '') : '';
    const used2 = tag2 ? tag2.replace(/\s/g, '') : '';
    const used3 = tag3 ? tag3.replace(/\s/g, '') : '';
    return !t.includes(used1) && !t.includes(used2) && !t.includes(used3);
  });

  let finalTags: string[] = [];
  if (tag1) finalTags.push(tag1);
  else if (unusedTokens.length > 0) finalTags.push(unusedTokens.shift() as string);

  if (tag2) finalTags.push(tag2);
  else if (unusedTokens.length > 0) finalTags.push(unusedTokens.shift() as string);

  if (tag3) finalTags.push(tag3);
  else if (unusedTokens.length > 0) finalTags.push(unusedTokens.shift() as string);

  return finalTags.filter(Boolean).slice(0, 3);
}
