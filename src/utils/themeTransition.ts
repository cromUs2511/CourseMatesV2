import { flushSync } from 'react-dom';

let transitioning = false;

export async function toggleThemeWithReveal(button: HTMLButtonElement, toggle: () => void) {
  if (transitioning) return;
  if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toggle();
    return;
  }
  const root = document.documentElement;
  const bounds = button.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  root.style.setProperty('--theme-reveal-x', `${x}px`);
  root.style.setProperty('--theme-reveal-y', `${y}px`);
  root.style.setProperty('--theme-reveal-radius', `${Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)))}px`);
  root.classList.add('theme-revealing');
  transitioning = true;
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    flushSync(toggle);
  };
  try {
    const transition = document.startViewTransition(commit);
    // Skipped snapshots still commit the selected theme.
    await transition.finished;
  } catch {
    commit();
  } finally {
    transitioning = false;
    root.classList.remove('theme-revealing');
    for (const property of ['--theme-reveal-x', '--theme-reveal-y', '--theme-reveal-radius']) root.style.removeProperty(property);
  }
}
