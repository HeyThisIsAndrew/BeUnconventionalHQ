#!/bin/bash

for file in src/components/EventAnnouncement.astro src/components/EventFeatured.astro; do
  # Add import if missing
  if ! grep -q "import ReferralLinks" "$file"; then
    sed -i '' '/import MiniCalendarSidebar/a\
import ReferralLinks from '"'"'./ReferralLinks.astro'"'"';\
' "$file"
  fi

  # Replace the right rail
  sed -i '' '/{[/]\* RIGHT RAIL: Widgets \*[/]}/,/<\/aside>/c\
        {/* RIGHT RAIL: Widgets */}\
        <aside class="article-rail article-rail-right" aria-labelledby="article-support-head">\
          <div class="article-rail-sticky">\
            \
            {/* Calendar */}\
            <div class="article-rail-related">\
              <p class="article-rail-head" id="article-support-head">Upcoming Events</p>\
              <MiniCalendarSidebar events={Astro.props.allEvents?.filter((e: any) => e.startDate >= new Date().toISOString().split('\''T'\'')[0]) || []} />\
            </div>\
\
            {/* Coverage Inquiry */}\
            <div class="article-rail-related mt-10">\
              <p class="article-rail-head">Coverage Inquiry</p>\
              <p class="text-gray-400 text-sm mb-4 leading-relaxed">\
                BE Unconventional HQ provides premium editorial coverage for events, including live photography, video interviews, and written features.\
              </p>\
              <a href="mailto:press@beunconventionalhq.com?subject=Press%20Inquiry" class="text-white text-xs font-bold uppercase tracking-wider hover:text-red-400 transition-colors border-b border-transparent hover:border-red-400 pb-1">\
                Contact Press Desk &rarr;\
              </a>\
            </div>\
            \
            {/* Affiliate / Support Cards */}\
            <div class="article-rail-support mt-10">\
              <ReferralLinks compact />\
            </div>\
\
          </div>\
        </aside>\
' "$file"

  # Increase the padding for the shrunk hero to avoid visual clipping by the navbar
  sed -i '' 's/min-height: 120px !important;/min-height: 140px !important;/g' "$file"
  sed -i '' 's/padding-top: 60px;/padding-top: 80px;/g' "$file"
done
