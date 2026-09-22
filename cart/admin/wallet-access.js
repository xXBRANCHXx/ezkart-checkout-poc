(() => {
  const content = document.querySelector('[data-wallet-content]');
  if (!content) return;
  const remaining = Math.max(0, Number(content.dataset.walletSeconds) || 0) * 1000;
  const deadline = Date.now() + remaining;
  const lock = () => {
    content.hidden = true;
    location.replace('?page=wallet');
  };
  setTimeout(lock, remaining);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() >= deadline) lock();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) lock(); });
})();
