let installPrompt;
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  const button = document.querySelector('[data-action="install"]');
  if (button) button.hidden = true;
});

export async function installApp() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  return true;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = document.body.dataset.base;
  navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch((error) => {
    console.warn('Aparta no ha podido activar el modo sin conexión.', error);
  });
}
