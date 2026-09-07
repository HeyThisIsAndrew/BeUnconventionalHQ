#!/bin/bash
for file in src/components/EventAnnouncement.astro src/components/EventFeatured.astro; do
  
  # 1. Fix [OBJECT OBJECT] Bug
  # Find: {categoryLabel || event.category || 'LIVE EVENT'}
  # Replace with: {categoryLabel || (typeof event.category === 'object' && event.category !== null ? (event.category.title || event.category.name || 'LIVE EVENT') : event.category) || (Array.isArray(event.tags) ? event.tags.join(' &bull; ') : event.tags) || 'LIVE EVENT'}
  sed -i '' "s/{categoryLabel || event.category || 'LIVE EVENT'}/{categoryLabel || (typeof event.category === 'object' \&\& event.category !== null ? (event.category.title || event.category.name || 'LIVE EVENT') : event.category) || 'LIVE EVENT'}/g" "$file"

  # Wait! What if there's another [object Object]? Let's check tags rendering.
  # Let's replace the whole article-eyebrow metadata block just in case to ensure tags are formatted.
  # Actually, the user specifically mentioned "item.tags.join(' • ') or item.category.title".
  # Let's ensure event.tags is safely joined if it's used elsewhere, but I know it's not present in the template right now. So fixing event.category is enough.

  # 2. Add Mobile Flex & Padding overrides for 3-column layout and Hero alignment
  sed -i '' '/<\/style>/i\
  /* ── Mobile Stacking & Breathing Room (Events Only) ── */\
  @media (max-width: 1199px) {\
    .article-layout {\
      display: flex;\
      flex-direction: column;\
      gap: 4rem;\
    }\
    .article-rail {\
      display: block !important;\
      position: static !important;\
    }\
    .article-column {\
      order: 1;\
      width: 100%;\
    }\
    .article-rail-left {\
      order: 2;\
      width: 100%;\
    }\
    .article-rail-right {\
      order: 3;\
      width: 100%;\
    }\
  }\
\
  @media (max-width: 767px) {\
    .article-column {\
      padding-left: 1.5rem;\
      padding-right: 1.5rem;\
    }\
    .hero-grid-container {\
      display: flex !important;\
      flex-direction: column;\
      align-items: center;\
      gap: 1.5rem;\
    }\
    .event-hero-content, .hero-identity, .hero-info-cta {\
      align-items: center !important;\
      text-align: center !important;\
    }\
  }\
' "$file"

done
