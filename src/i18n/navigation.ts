import { createNavigation } from 'next-intl/navigation';
import { locales, defaultLocale, localeDetection } from './config';

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation({
    locales,
    defaultLocale,
    localePrefix: 'as-needed',
    localeDetection,
  });
