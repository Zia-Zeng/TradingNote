export function registerPwa() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).catch(error => {
      console.warn('M-TradingNote offline shell registration failed.', error);
    });
  }, { once: true });
}
