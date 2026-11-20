export const THEME_KEY = 'webapp-ahorro:theme';
export const THEME_COLORS = { dark: '#0b0b0a', light: '#f8f8f4' };

export function applyTheme(theme) {
  const mode = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]').content = THEME_COLORS[mode];
  return mode;
}
