import { useTranslations } from 'next-intl';
import { cn } from '@aster-cloud/ui';

/**
 * Banner shown at the top of locale-fallback docs pages.
 *
 * When a zh.mdx or de.mdx is byte-identical to its sibling en.mdx
 * (detected at build time by scripts/docs-migration/mark-fallbacks.mjs),
 * the migration step injects `<TranslationFallbackBanner />` as the
 * first MDX node so readers know they are seeing the English source.
 *
 * Why client-readable strings instead of locale-prop:
 *   - next-intl already provides the locale via the surrounding layout's
 *     <NextIntlClientProvider>, so we just consume `useTranslations`.
 *   - The banner copy is localized via messages/{en,zh,de}.json under
 *     `docs.fallbackBanner.*`. EN copy exists so users on /en/docs/* never
 *     see the banner anyway, but a fallback key prevents render errors
 *     if it ever does (defense-in-depth).
 */
export function TranslationFallbackBanner() {
  const t = useTranslations();
  return (
    <div
      role="status"
      className={cn(
        'not-prose mb-6 rounded-md border border-warning/40 bg-warning/5',
        'px-4 py-3 text-sm text-fg',
      )}
    >
      <p className="m-0 flex items-start gap-2">
        <span aria-hidden className="text-warning">⚠</span>
        <span>
          <strong className="font-medium">{t('docs.fallbackBanner.title')}</strong>
          {' — '}
          {t('docs.fallbackBanner.body')}
        </span>
      </p>
    </div>
  );
}
