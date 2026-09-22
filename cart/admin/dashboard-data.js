(() => {
  'use strict';
  // Failed or removed photos reveal the product icon / customer's initials.
  for (const image of document.querySelectorAll('[data-record-image]')) {
    const fallback = () => { image.hidden = true; };
    image.addEventListener('error', fallback);
    if (image.complete && image.naturalWidth === 0) fallback();
  }
})();
