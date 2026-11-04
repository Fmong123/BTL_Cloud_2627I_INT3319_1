import { useEffect } from 'react';
import { useWorkspace } from './Workspace.jsx';

export default function Theme() {
  const { preferences } = useWorkspace();
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      document.querySelector('meta[name="theme-color"]').content =
        resolved === 'dark' ? '#151320' : '#f4f2fc';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);
  return null;
}
