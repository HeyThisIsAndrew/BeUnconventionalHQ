#!/bin/bash
# Insert JS right before the end of the script block
sed -i '' '/const HUB_LEAD_IN_MS = 900;/i\
  const eventHero = document.querySelector(".event-hero");\
  if (eventHero) {\
    window.addEventListener("scroll", () => {\
      if (window.innerWidth >= 768) {\
        if (window.scrollY > 150) {\
          eventHero.classList.add("hero-shrunk");\
        } else {\
          eventHero.classList.remove("hero-shrunk");\
        }\
      } else {\
        eventHero.classList.remove("hero-shrunk");\
      }\
    }, { passive: true });\
  }\
' src/components/EventAnnouncement.astro

# Append CSS right before </style>
sed -i '' '/<\/style>/i\
  @media (min-width: 768px) {\
    .event-hero {\
      position: sticky;\
      top: 0;\
      z-index: 40;\
    }\
    .event-hero-overlay {\
      transition: min-height 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), padding 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);\
      will-change: min-height;\
    }\
    .event-hero.hero-shrunk .event-hero-overlay {\
      min-height: 120px !important;\
      padding-top: 60px;\
      padding-bottom: 0;\
    }\
    .event-hero.hero-shrunk .hub-rail,\
    .event-hero.hero-shrunk .hero-description-wrapper,\
    .event-hero.hero-shrunk .hero-info-cta {\
      opacity: 0;\
      pointer-events: none;\
      position: absolute;\
      visibility: hidden;\
    }\
    .event-hero.hero-shrunk .hero-identity {\
      flex-direction: row;\
      align-items: center;\
      margin-bottom: 0;\
    }\
    .event-hero.hero-shrunk .hero-logo {\
      max-height: 50px !important;\
      transition: max-height 0.4s ease;\
    }\
    .event-hero.hero-shrunk .hero-title {\
      font-size: 1.5rem;\
      transition: font-size 0.4s ease;\
    }\
    .event-hero.hero-shrunk .hub-stage {\
      opacity: 0;\
      transform: scale(0.95);\
      pointer-events: none;\
      transition: opacity 0.4s ease, transform 0.4s ease;\
    }\
  }\
' src/components/EventAnnouncement.astro
