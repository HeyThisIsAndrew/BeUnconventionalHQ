  (function () {
    let scrollHandler = null;
    let observer = null;

    function initNavObserver() {
      const identity = document.getElementById('nav-identity');
      const sublineEl = document.getElementById('nav-subline');
      if (!identity) return;

      // 1. Dynamic Red Subline
      const path = window.location.pathname;
      let subtext = '';
      if (path.includes('category')) subtext = 'HUB';
      else if (path.includes('about')) subtext = 'ABOUT';
      else if (path.includes('contact')) subtext = 'CONTACT';

      if (sublineEl) {
        sublineEl.textContent = subtext;
        sublineEl.style.display = subtext ? 'inline-block' : 'none';
      }

      // 2. Smooth Scroll to Top (avoid duplicate listeners on SPA transitions)
      if (!identity.dataset.clickBound) {
        identity.addEventListener('click', (e) => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
        identity.dataset.clickBound = 'true';
      }

      // Cleanup old observer and scroll handler to prevent memory leaks
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
        scrollHandler = null;
      }

      // 3. Visibility Logic
      const anchor = document.querySelector('[data-nav-anchor]');

      function updateVisibility(isVisible) {
        if (isVisible) {
          identity.style.opacity = '1';
          identity.style.transform = 'translateY(0) scale(1)';
          identity.style.pointerEvents = 'auto';
        } else {
          identity.style.opacity = '0';
          identity.style.transform = 'translateY(-10px) scale(0.95)';
          identity.style.pointerEvents = 'none';
        }
      }

      if (anchor) {
        // We are on the homepage. Watch the Hero text.
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              updateVisibility(!entry.isIntersecting);
            });
          },
          { rootMargin: '-80px 0px 0px 0px' }
        );
        const rect = anchor.getBoundingClientRect();
        updateVisibility(rect.bottom <= 0);
        observer.observe(anchor);
      } else {
        // We are on a subpage. Fallback to basic scroll threshold.
        scrollHandler = () => {
          const scroll = window.scrollY || document.documentElement.scrollTop;
          updateVisibility(scroll > 100);
        };
        window.addEventListener('scroll', scrollHandler, { passive: true });

        // INSTANTLY check state on load so it doesn't get stuck visible!
        scrollHandler();
      }
    }

    function updateActiveNavLinks() {
      const currentPath = window.location.pathname.replace(/\/$/, '');
      const navLinks = document.querySelectorAll('.nav-list .nav-item a');

      navLinks.forEach((link) => {
        const linkPath = new URL(link.href).pathname.replace(/\/$/, '');
        if (currentPath === linkPath) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      });
    }

    // updateActiveNavLinks(); 
    // We remove the immediate call because astro:page-load fires on initial load.

    if (!window.navbarObserverSetup) {
      document.addEventListener('astro:page-load', initNavObserver);
      document.addEventListener('astro:page-load', updateActiveNavLinks);
      window.navbarObserverSetup = true;
    }
  })();

  (function () {
    function initMobileMenu() {
      const navbar = document.getElementById('navbar');
      const toggle = document.querySelector('.nav-toggle');

      if (navbar && toggle) {
        // Clear any existing listeners by cloning the toggle to prevent duplicates on soft navs
        const newToggle = toggle.cloneNode(true);
        toggle.parentNode.replaceChild(newToggle, toggle);

        newToggle.addEventListener('click', () => {
          const isOpened = navbar.classList.contains('menu-open');
          if (isOpened) {
            // Guard clause to prevent state corruption
            if (!document.documentElement.classList.contains('menu-open'))
              return;

            const scrollY = Math.abs(parseInt(document.body.style.top || '0'));
            navbar.classList.remove('menu-open');
            document.documentElement.classList.remove('menu-open');
            newToggle.setAttribute('aria-expanded', 'false');

            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.width = '';

            // Double requestAnimationFrame for native thread safety
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const originalBehavior =
                  document.documentElement.style.scrollBehavior;
                document.documentElement.style.scrollBehavior = 'auto'; // Force instant
                window.scrollTo(0, scrollY);
                document.documentElement.style.scrollBehavior =
                  originalBehavior;
              });
            });
          } else {
            // Capture scroll position
            const scrollY = window.scrollY;
            document.body.style.top = `-${scrollY}px`;

            navbar.classList.add('menu-open');
            document.documentElement.classList.add('menu-open');
            newToggle.setAttribute('aria-expanded', 'true');
          }
        });

        const navLinks = navbar.querySelectorAll('.nav-list a');
        navLinks.forEach((link) => {
          if (!link.dataset.mobileClickBound) {
            link.addEventListener('click', () => {
            if (navbar.classList.contains('menu-open')) {
              // Guard clause
              if (!document.documentElement.classList.contains('menu-open'))
                return;

              const scrollY = Math.abs(
                parseInt(document.body.style.top || '0')
              );
              navbar.classList.remove('menu-open');
              document.documentElement.classList.remove('menu-open');
              newToggle.setAttribute('aria-expanded', 'false');

              document.body.style.position = '';
              document.body.style.top = '';
              document.body.style.width = '';

              // Double requestAnimationFrame for native thread safety
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  const originalBehavior =
                    document.documentElement.style.scrollBehavior;
                  document.documentElement.style.scrollBehavior = 'auto'; // Force instant
                  window.scrollTo(0, scrollY);
                  document.documentElement.style.scrollBehavior =
                    originalBehavior;
                });
              });
            }
          });
          link.dataset.mobileClickBound = 'true';
        }
        });
    }

    } // Ends initMobileMenu

    if (!window.navbarMobileMenuSetup) {
      document.addEventListener('astro:page-load', initMobileMenu);
      window.navbarMobileMenuSetup = true;
    }
  })();
