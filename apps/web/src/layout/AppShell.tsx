import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { BookOpen, Compass, LogOut, Menu as MenuIcon, Moon, Plus, Settings, Split, Sun, SunMoon, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { Button, Spinner, useToast } from '../components/ui';
import { put } from '../api/client';
import type { Preferences } from '@whatif/shared';

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M8 22 L14 14 L18 18 L24 9" fill="none" stroke="var(--text-inverse)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="9" r="2.2" fill="var(--text-inverse)" />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Overview', icon: Compass, end: true },
  { to: '/decisions', label: 'Decisions', icon: Split, end: false },
  { to: '/journal', label: 'Journal', icon: BookOpen, end: false },
  { to: '/settings/profile', label: 'Settings', icon: Settings, end: false, match: '/settings' },
];

function ThemeToggle() {
  const { preferences, updatePreferences } = useSession();
  const toast = useToast();
  const order: NonNullable<Preferences['theme']>[] = ['system', 'light', 'dark'];
  const current = preferences.theme ?? 'system';
  const next = order[(order.indexOf(current) + 1) % order.length]!;
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : SunMoon;
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      icon={<Icon />}
      title={`Theme: ${current}. Switch to ${next}.`}
      onClick={async () => {
        updatePreferences({ ...preferences, theme: next });
        try {
          await put('/preferences', { theme: next });
        } catch {
          toast('Theme changed for this session but could not be saved.', 'bad');
        }
      }}
    >
      Change theme
    </Button>
  );
}

export function AppShell() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);

  const nav = (
    <>
      <div className="sidebar-top">
        <NavLink to="/" className="brand" aria-label="What-If home">
          <BrandMark />
          <span>What-If</span>
        </NavLink>
        <Button className="mobile-only" variant="ghost" size="sm" iconOnly icon={<X />} onClick={() => setOpen(false)}>
          Close menu
        </Button>
      </div>
      <Button variant="secondary" block icon={<Plus />} onClick={() => navigate('/decisions/new')} className="sidebar-new">
        New decision
      </Button>
      <nav className="sidebar-nav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive || (n.match && loc.pathname.startsWith(n.match)) ? 'active' : ''}`}>
            <n.icon aria-hidden />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-user">
          <div className="avatar" aria-hidden>
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="who">
            <div className="name">{user?.name}</div>
            <div className="email">{user?.email}</div>
          </div>
        </div>
        <div className="sidebar-actions">
          <ThemeToggle />
          <Button variant="ghost" size="sm" iconOnly icon={<LogOut />} title="Sign out" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar desktop-only" aria-label="Sidebar">
        {nav}
      </aside>
      {open && (
        <div className="drawer-backdrop" onClick={() => setOpen(false)}>
          <aside className="sidebar drawer" onClick={(e) => e.stopPropagation()} aria-label="Sidebar">
            {nav}
          </aside>
        </div>
      )}
      <div className="main-col">
        <header className="topbar mobile-only">
          <Button variant="ghost" size="sm" iconOnly icon={<MenuIcon />} onClick={() => setOpen(true)}>
            Open menu
          </Button>
          <NavLink to="/" className="brand">
            <BrandMark size={20} />
            <span>What-If</span>
          </NavLink>
          <Button variant="ghost" size="sm" iconOnly icon={<Plus />} onClick={() => navigate('/decisions/new')}>
            New decision
          </Button>
        </header>
        <main id="main" className="main">
          <Suspense
            fallback={
              <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
                <Spinner />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
