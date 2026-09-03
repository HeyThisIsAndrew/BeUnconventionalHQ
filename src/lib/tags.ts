export function getDisplayTags(item: any): string[] {
  if (!item) return [];
  let explicitTokens: string[] = [];
  
  if (Array.isArray(item.youtubeTags)) explicitTokens.push(...item.youtubeTags);
  if (Array.isArray(item.tags)) explicitTokens.push(...item.tags);

  let cleanTokens = explicitTokens.map(t => typeof t === 'string' ? t.replace(/[#@\s]/g, '').toUpperCase() : '');
  cleanTokens = [...new Set(cleanTokens.filter(Boolean))];

  let tag1 = item.badge1 || '';
  const brandMap = [
    { label: 'MARVEL', regex: /MARVEL|WOLVERINE|AVENGERS|SPIDER|XMEN|MCU|DEADPOOL|VENOM/ },
    { label: 'DC', regex: /DC$|DCU|BATMAN|SUPERMAN|WONDERWOMAN|JUSTICELEAGUE|JOKER|LANTERNS/ },
    { label: 'NETFLIX', regex: /NETFLIX/ },
    { label: 'APPLE TV+', regex: /APPLE/ },
    { label: 'DISNEY', regex: /DISNEY/ },
    { label: 'SONY PICTURES', regex: /SONYPICTURES/ },
    { label: 'PLAYSTATION', regex: /\bSONY\b|PLAYSTATION|PS5|PS4/ },
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

  if (!tag1) {
    for (const b of brandMap) {
      const match = cleanTokens.find(t => b.regex.test(t));
      if (match) {
        tag1 = b.label;
        break;
      }
    }
  }

  let tag2 = item.badge2 || '';
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
    { label: 'ANNOUNCEMENT', regex: /ANNOUNCEMENT/ },
    { label: 'DISPATCH', regex: /DISPATCH/ }
  ];

  if (!tag2) {
    for (const type of typeMap) {
      const match = cleanTokens.find(t => type.regex.test(t));
      if (match) {
        tag2 = type.label;
        break;
      } else if (item.contentType && type.regex.test(item.contentType.toUpperCase())) {
        tag2 = type.label;
        break;
      }
    }
  }

  let tag3 = item.badge3 || '';
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

  if (!tag3) {
    for (const e of eventMap) {
      if (tag2 === e.label) continue;
      const match = cleanTokens.find(t => e.regex.test(t));
      if (match) {
        tag3 = e.label;
        break;
      }
    }
  }

  let finalTags: string[] = [];
  if (tag1) finalTags.push(tag1);
  if (tag2) finalTags.push(tag2);
  if (tag3) finalTags.push(tag3);

  return finalTags.filter(Boolean).slice(0, 3);
}
