#!/bin/bash
for file in src/components/EventAnnouncement.astro src/components/EventFeatured.astro; do
  # Replace top: 0; with top: 62px;
  sed -i '' 's/top: 0;/top: 62px;/g' "$file"

  # Replace the min-height and padding for the shrunk overlay
  sed -i '' 's/min-height: 140px !important;/min-height: 80px !important;/g' "$file"
  sed -i '' 's/padding-top: 80px;/padding-top: 0.5rem;/g' "$file"
done
