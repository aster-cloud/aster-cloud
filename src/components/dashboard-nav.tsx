'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Link } from '@/i18n/navigation';

interface NavItem {
  href: string;
  label: string;
}

interface DashboardNavClientProps {
  navItems: NavItem[];
  secondaryItems: NavItem[];
  userMenuLabels: {
    profile: string;
    settings: string;
    signOut: string;
    signingOut: string;
  };
  mobileMenuLabels: {
    openMenu: string;
    closeMenu: string;
  };
  userName?: string;
  userEmail?: string;
}

export function MobileMenuButton({
  isOpen,
  onToggle,
  labels,
}: {
  isOpen: boolean;
  onToggle: () => void;
  labels: { openMenu: string; closeMenu: string };
}) {
  return (
    <button
      type="button"
      className="sm:hidden inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
      aria-expanded={isOpen}
      aria-label={isOpen ? labels.closeMenu : labels.openMenu}
      onClick={onToggle}
    >
      {isOpen ? (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ) : (
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      )}
    </button>
  );
}

export function UserDropdown({
  userMenuLabels,
  userName,
  userEmail,
}: {
  userMenuLabels: { profile: string; settings: string; signOut: string; signingOut: string };
  userName?: string;
  userEmail?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOut({ callbackUrl: '/' });
  };

  const userInitial = userName?.charAt(0)?.toUpperCase() || userEmail?.charAt(0)?.toUpperCase() || 'U';

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={userMenuLabels.profile}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-indigo-600 text-sm font-medium">{userInitial}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg py-1 bg-white ring-1 ring-black ring-opacity-5 z-50">
          {userEmail && (
            <div className="px-4 py-2 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-900 truncate">{userName || userEmail}</p>
              {userName && <p className="text-xs text-gray-500 truncate">{userEmail}</p>}
            </div>
          )}
          <Link
            href="/settings"
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={() => setIsOpen(false)}
          >
            {userMenuLabels.settings}
          </Link>
          <button
            type="button"
            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            {isSigningOut ? userMenuLabels.signingOut : userMenuLabels.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

export function DesktopNav({ navItems }: { navItems: NavItem[] }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
    if (href === '/dashboard') {
      return pathWithoutLocale === '/dashboard' || pathWithoutLocale === '';
    }
    return pathWithoutLocale.startsWith(href);
  };

  return (
    <div className="hidden sm:ml-8 sm:flex sm:space-x-8">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
            isActive(item.href)
              ? 'border-indigo-500 text-gray-900'
              : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
          }`}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

export function MobileNav({
  isOpen,
  navItems,
  secondaryItems,
}: {
  isOpen: boolean;
  navItems: NavItem[];
  secondaryItems: NavItem[];
}) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
    if (href === '/dashboard') {
      return pathWithoutLocale === '/dashboard' || pathWithoutLocale === '';
    }
    return pathWithoutLocale.startsWith(href);
  };

  if (!isOpen) return null;

  return (
    <div className="sm:hidden absolute top-16 inset-x-0 bg-white border-b border-gray-200 shadow-lg z-50">
      <div className="pt-2 pb-3 space-y-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
              isActive(item.href)
                ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
            }`}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div className="pt-2 pb-3 border-t border-gray-200">
        {secondaryItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
              isActive(item.href)
                ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                : 'border-transparent text-gray-500 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-700'
            }`}
            aria-current={isActive(item.href) ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DashboardNavClient({
  navItems,
  secondaryItems,
  userMenuLabels,
  mobileMenuLabels,
  userName,
  userEmail,
}: DashboardNavClientProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  return (
    <>
      <MobileMenuButton
        isOpen={isMobileMenuOpen}
        onToggle={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        labels={mobileMenuLabels}
      />
      <DesktopNav navItems={navItems} />
      <MobileNav
        isOpen={isMobileMenuOpen}
        navItems={navItems}
        secondaryItems={secondaryItems}
      />
    </>
  );
}
