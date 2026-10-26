'use client';

import {
  Building2,
  CalendarRange,
  KeyRound,
  Timer,
  UsersRound,
  ScrollText,
  BookOpen,
  Webhook,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MailWarning,
  Star,
  UserCircle,
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
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './Notifications';
import { LiveIndicator } from './LiveIndicator';
import { useOrgSettings, useProjects } from '@/features/queries';
import { api } from '@/lib/api';
import { toastError, toastSuccess } from '@/lib/alerts';
import { SLOW_EVENT } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { hasGlobal } from '@/lib/permissions';
import { TwoFactorBanner } from '@/features/security/TwoFactorBanner';
import type { GlobalPermission } from '@/lib/types';
import { cn } from '@/lib/cn';
import { useTheme } from '@/lib/theme';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Organisation permission needed to see the entry ('admin' = administrators only). */
  perm?: GlobalPermission | 'admin';
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/projects', label: 'Projects', icon: FolderKanban },
      { href: '/timesheet', label: 'My timesheet', icon: Timer },
      { href: '/planner', label: 'Resource planner', icon: CalendarRange },
      // [workspace nav: collaboration]
      // [workspace nav: import-scheduling]
    ],
  },
  {
    section: 'Admin',
    items: [
      { href: '/users', label: 'Users', icon: Users, perm: 'manage_users' },
      { href: '/groups', label: 'Groups', icon: UsersRound, perm: 'manage_users' },
      { href: '/roles', label: 'Roles & permissions', icon: KeyRound, perm: 'admin' },
      { href: '/work-settings', label: 'Work settings', icon: ListChecks, perm: 'manage_work_settings' },
      { href: '/settings', label: 'Organisation', icon: Settings, perm: 'admin' },
      // [admin nav: security-integrations]
      { href: '/webhooks', label: 'Webhooks', icon: Webhook, perm: 'admin' },
      // Everyone can open API docs from My profile → API tokens; the sidebar link is for admins.
      { href: '/api-docs', label: 'API docs', icon: BookOpen, perm: 'admin' },
      // [admin nav: platform]
      { href: '/audit', label: 'Audit trail', icon: ScrollText, perm: 'admin' },
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
        <VerifyEmailBanner />
        <TwoFactorBanner />
        <main className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-3 sm:p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Sidebar({ collapsed, mobileOpen, orgName, onToggle, onClose }: { collapsed: boolean; mobileOpen: boolean; orgName: string; onToggle: () => void; onClose: () => void }) {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();
  const { themeColor } = useTheme();
  const allowed = (item: NavItem) => !item.perm || (item.perm === 'admin' ? isAdmin : hasGlobal(user, item.perm));

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
        <FavoritesNav collapsed={collapsed} />
        {NAV.map((group) => {
          const items = group.items.filter(allowed);
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
          <span className="hidden xl:block text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <GlobalSearch />
          <LiveIndicator />
          <NotificationBell />
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
                <Link
                  href="/profile"
                  onClick={() => setMenuOpen(false)}
                  role="menuitem"
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                >
                  <UserCircle className="w-4 h-4" /> My profile
                </Link>
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

/** Quick links to the user's starred projects. */
function FavoritesNav({ collapsed }: { collapsed: boolean }) {
  const projects = useProjects();
  const pathname = usePathname();
  const { themeColor } = useTheme();
  const favorites = (projects.data ?? []).filter((p) => p.favorite).slice(0, 8);
  if (!favorites.length) return null;
  return (
    <div>
      <p className={cn('px-2.5 mb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1', collapsed && 'lg:justify-center lg:px-0')}>
        <Star className="w-3 h-3" />
        <span className={cn(collapsed && 'lg:hidden')}>Favorites</span>
      </p>
      <ul className="space-y-0.5">
        {favorites.map((p) => {
          const active = pathname.startsWith(`/projects/${p._id}`);
          return (
            <li key={p._id}>
              <Link
                href={`/projects/${p._id}`}
                title={p.name}
                className={cn('flex items-center gap-2.5 py-1.5 px-2.5 rounded-lg text-[14px] transition-colors', active ? 'font-semibold' : 'font-medium text-gray-600 dark:text-gray-300 theme-nav-hover', collapsed && 'lg:justify-center')}
                style={active ? { color: themeColor, backgroundColor: `${themeColor}1a` } : undefined}
              >
                <span className="w-5 h-5 rounded text-[9px] font-bold flex items-center justify-center shrink-0 text-white" style={{ backgroundColor: themeColor }}>
                  {(p.key || p.name).slice(0, 2)}
                </span>
                <span className={cn('truncate', collapsed && 'lg:hidden')}>{p.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Reminds people to confirm their email (needed for email notifications). */
function VerifyEmailBanner() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState(false);
  const [sending, setSending] = useState(false);
  if (!user || user.emailVerified !== false || hidden) return null;
  return (
    <div className="mx-1 mt-1 px-4 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm flex flex-wrap items-center gap-2">
      <MailWarning className="w-4 h-4 shrink-0" />
      <span className="flex-1 min-w-0">Please confirm your email address ({user.email}) to receive email notifications.</span>
      <button
        type="button"
        disabled={sending}
        className="font-medium underline disabled:opacity-50"
        onClick={async () => {
          setSending(true);
          try {
            await api('/auth/resend-verification', { method: 'POST' });
            void toastSuccess('Confirmation email sent');
          } catch {
            void toastError('Could not send the email');
          } finally {
            setSending(false);
          }
        }}
      >
        Resend email
      </button>
      <button type="button" className="text-blue-500 hover:text-blue-700" onClick={() => setHidden(true)} aria-label="Dismiss">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
