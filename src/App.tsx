import { useCallback, useEffect, useState } from 'react';
import { CustomerMenuView } from './components/CustomerMenuView';
import { OwnerPanelView } from './components/OwnerPanelView';
import { RegistrationView } from './components/RegistrationView';
import { StoreDirectoryView } from './components/StoreDirectoryView';

function normalizePathname(raw: string): string {
  const clean = raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return clean || '/';
}

const VALID_SLUG_REGEX = /^\/[a-zA-Z0-9_-]+$/;

function isKnownRoute(path: string): boolean {
  if (path === '/' || path === '/cadastro' || path === '/painel' || path === '/admin') {
    return true;
  }
  return VALID_SLUG_REGEX.test(path);
}

export default function App() {
  const [pathname, setPathname] = useState<string>(() => {
    const initial = normalizePathname(window.location.pathname);
    return isKnownRoute(initial) ? initial : '/';
  });

  useEffect(() => {
    const initial = normalizePathname(window.location.pathname);
    if (!isKnownRoute(initial)) {
      window.history.replaceState({}, '', '/');
    }

    const handlePopState = () => {
      const next = normalizePathname(window.location.pathname);
      if (!isKnownRoute(next)) {
        window.history.replaceState({}, '', '/');
        setPathname('/');
      } else {
        setPathname(next);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = useCallback((targetPath: string) => {
    const normalized = normalizePathname(targetPath);
    const next = isKnownRoute(normalized) ? normalized : '/';
    if (next !== normalizePathname(window.location.pathname)) {
      window.history.pushState({}, '', next);
    }
    setPathname(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (pathname === '/' || pathname === '') {
    return <StoreDirectoryView onNavigate={navigate} />;
  }

  if (pathname === '/cadastro') {
    return <RegistrationView onNavigate={navigate} />;
  }

  if (pathname === '/painel' || pathname === '/admin') {
    return <OwnerPanelView onNavigate={navigate} />;
  }

  const slug = pathname.slice(1);
  return <CustomerMenuView slug={slug} />;
}
