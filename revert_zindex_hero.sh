#!/bin/bash
for file in src/components/EventAnnouncement.astro src/components/EventFeatured.astro; do
  sed -i '' 's/top: 62px;/top: 0;/g' "$file"
  sed -i '' 's/min-height: 80px !important;/min-height: 140px !important;/g' "$file"
  sed -i '' 's/padding-top: 0.5rem;/padding-top: 72px;/g' "$file"
done
