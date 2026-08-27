const fs = require('fs');
const path = 'src/pages/featured/index.astro';
let content = fs.readFileSync(path, 'utf8');

const touchBlockRegex = /\/\/ Swipe Gestures[\s\S]*?(?=\/\/ Deck Stack Clicks & Parallax)/;

const newGestureBlock = `// Swipe & Drag & Scroll Gestures
      const deckStack = section.querySelector('.deck-stack');
      if (deckStack) {
        // Shared swipe logic
        const handleSwipe = (diff) => {
          if (Math.abs(diff) > 50) {
            if (diff > 0) {
              activeIndex = (activeIndex + 1) % cards.length;
            } else {
              activeIndex = (activeIndex - 1 + cards.length) % cards.length;
            }
            renderDeck();
          }
        };

        // Touch events (mobile/tablet)
        let touchStartX = 0;
        deckStack.addEventListener('touchstart', (e) => {
          touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });
        deckStack.addEventListener('touchend', (e) => {
          handleSwipe(touchStartX - e.changedTouches[0].screenX);
        }, { passive: true });

        // Pointer events (click & drag on desktop/tablet)
        let isPointerDown = false;
        let pointerStartX = 0;
        deckStack.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          isPointerDown = true;
          pointerStartX = e.screenX;
          try { deckStack.setPointerCapture(e.pointerId); } catch(err){}
        });
        
        const endPointer = (e) => {
          if (!isPointerDown) return;
          isPointerDown = false;
          try { deckStack.releasePointerCapture(e.pointerId); } catch(err){}
          const diff = pointerStartX - e.screenX;
          if (Math.abs(diff) > 50) {
            deckStack.dataset.preventClick = 'true';
            setTimeout(() => { deckStack.dataset.preventClick = 'false'; }, 100);
            handleSwipe(diff);
          }
        };
        deckStack.addEventListener('pointerup', endPointer);
        deckStack.addEventListener('pointercancel', endPointer);

        // Wheel events (mouse pad swipe / scroll)
        let wheelTimeout;
        let isWheeling = false;
        let accumulatedDelta = 0;
        
        deckStack.addEventListener('wheel', (e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            e.preventDefault();
            
            if (!isWheeling) {
              isWheeling = true;
              accumulatedDelta = 0;
            }
            
            accumulatedDelta += e.deltaX;
            
            clearTimeout(wheelTimeout);
            wheelTimeout = setTimeout(() => {
              isWheeling = false;
              handleSwipe(accumulatedDelta);
            }, 80);
          }
        }, { passive: false });
      }

      `;

content = content.replace(touchBlockRegex, newGestureBlock);
fs.writeFileSync(path, content);
