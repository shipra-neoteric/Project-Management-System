'use client';

import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PageLoader } from '@/components/ui/Feedback';
import { useOrgSettings } from '@/features/queries';
import { SLOW_EVENT } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/projects', label: 'Projects', icon: FolderKanban },
    ],
  },
  {
    section: 'Admin',
    items: [
      { href: '/users', label: 'Users', icon: Users, adminOnly: true },
      { href: '/settings', label: 'Organisation', icon: Settings, adminOnly: true },
    ],
  },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setThemeColor } = useTheme();
  const settings = useOrgSettings(status === 'authenticated');

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('pms_sidebar_collapsed') === '1');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (settings.data?.themeColor) setThemeColor(settings.data.themeColor);
  }, [settings.data?.themeColor, setThemeColor]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('pms_sidebar_collapsed', c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  if (status !== 'authenticated') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageLoader label="Loading your workspace…" />
      </div>
    );
  }

  const orgName = settings.data?.orgName ?? 'Project Management';

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {mobileOpen && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[55] lg:hidden" onClick={() => setMobileOpen(false)} />}
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} orgName={orgName} onToggle={toggleCollapsed} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header onMenu={() => setMobileOpen(true)} orgName={orgName} />
        <SlowServerBanner />
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-3 sm:p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, orgName, onToggle, onClose }: { collapsed: boolean; mobileOpen: boolean; orgName: string; onToggle: () => void; onClose: () => void }) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const { themeColor } = useTheme();

  return (
    <aside
      className={cn(
        'fixed lg:static inset-y-0 left-0 z-[60] flex flex-col transition-all duration-300',
        'bg-white/90 dark:bg-gray-800/95 backdrop-blur-xl border-r lg:border border-gray-100 dark:border-gray-700/50',
        'shadow-[0_8px_30px_rgb(0,0,0,0.04)] lg:my-1 lg:ml-1 lg:rounded-xl',
        mobileOpen ? 'translate-x-0 w-80 max-w-[85vw]' : '-translate-x-full lg:translate-x-0',
        collapsed ? 'lg:w-20' : 'lg:w-64',
      )}
    >
      <div className="h-16 flex items-center gap-3 px-4 border-b border-gray-100 dark:border-gray-700/50 shrink-0">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0 theme-gradient shadow-sm">
          {initials(orgName) || <Building2 className="w-5 h-5" />}
        </div>
        <div className={cn('min-w-0 flex-1', collapsed && 'lg:hidden')}>
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{orgName}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">Project Management System</p>
        </div>
        <button onClick={onClose} className="lg:hidden p-2 text-gray-400 hover:text-gray-600 rounded-lg" aria-label="Close menu">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 py-4 space-y-5">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || isAdmin);
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className={cn('px-2.5 mb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider', collapsed && 'lg:text-center lg:px-0')}>
                {collapsed ? <span className="hidden lg:inline">•••</span> : null}
                <span className={cn(collapsed && 'lg:hidden')}>{group.section}</span>
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          'flex items-center gap-3 py-2 px-2.5 rounded-lg text-[15px] transition-colors',
                          active ? 'font-semibold' : 'font-medium text-gray-600 dark:text-gray-300 theme-nav-hover',
                          collapsed && 'lg:justify-center',
                        )}
                        style={active ? { color: themeColor, backgroundColor: `${themeColor}1a` } : undefined}
                      >
                        <Icon className="w-5 h-5 shrink-0" />
                        <span className={cn(collapsed && 'lg:hidden')}>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="hidden lg:block p-3 border-t border-gray-100 dark:border-gray-700/50">
        <button
          onClick={onToggle}
          className={cn(
            'w-full flex items-center gap-3 py-2 px-2.5 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
            collapsed && 'justify-center',
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="w-5 h-5" /> : <ChevronsLeft className="w-5 h-5" />}
          {!collapsed && 'Collapse'}
        </button>
      </div>
    </aside>
  );
}

function Header({ onMenu, orgName }: { onMenu: () => void; orgName: string }) {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  return (
    <header className="relative z-[50] mt-1 mx-1 rounded-xl bg-white/80 dark:bg-gray-800/90 backdrop-blur-md shadow-sm border border-gray-200/50 dark:border-gray-700/50 shrink-0">
      <div className="flex items-center justify-between px-3 sm:px-4 lg:px-6 h-16">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={onMenu} className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label="Open menu" title="Menu">
            <Menu className="w-5 h-5" />
          </button>
          <span className="lg:hidden text-sm font-semibold text-gray-900 dark:text-white truncate">{orgName}</span>
          <span className="hidden lg:block text-sm text-gray-500 dark:text-gray-400">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleTheme}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="w-8 h-8 rounded-full theme-gradient text-white text-xs font-bold flex items-center justify-center">
                {initials(user?.name ?? '')}
              </span>
              <span className="hidden sm:block text-left">
                <span className="block text-sm font-medium text-gray-900 dark:text-white leading-tight">{user?.name}</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400 leading-tight">{user?.role}</span>
              </span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-hidden animate-fade-in-down" role="menu">
                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                >
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

/** Render's free tier sleeps when idle; tell people why the first request is slow. */
function SlowServerBanner() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const onSlow = (e: Event) => setSlow((e as CustomEvent<boolean>).detail);
    window.addEventListener(SLOW_EVENT, onSlow);
    return () => window.removeEventListener(SLOW_EVENT, onSlow);
  }, []);
  if (!slow) return null;
  return (
    <div className="mx-1 mt-1 px-4 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-sm animate-fade-in-down">
      Waking up the server… the free hosting plan sleeps when idle, so this can take up to a minute.
    </div>
  );
}
