/**
 * Animated Aster CNL demo for the marketing landing page.
 *
 * Why this exists: the landing hero used to *describe* Aster as a
 * "policy DSL in your own language" but never showed it working. The
 * difference between "we have a DSL" and "look, this compiles" is the
 * whole pitch — so the page needs to literally render CNL.
 *
 * Why not Monaco: Monaco is ~700KB minified. Mounting it on every
 * landing-page visit costs more than the conversion value of "fancy
 * editor on the home page". This component does CSS+React typewriter
 * with regex-driven syntax classes — same brand palette as the real
 * editor, ~3KB of code, no editor dependency.
 *
 * Why three snippets: one is enough to read, three signal the breadth
 * of use cases (finance / compliance / workflow). Cycling timer is
 * 7s per snippet — long enough to read the full block, short enough
 * that the page doesn't feel static.
 *
 * Accessibility: `aria-live="polite"` so screen readers can pick up
 * the typing if a user is focused on the demo, but it doesn't
 * interrupt navigation announcements. Reduced-motion users get the
 * final state of each snippet without the typewriter animation.
 */
'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { cn } from '@/components/ui';

interface CnlSnippet {
  /** Short label rendered above the code (e.g. "Loan eligibility") */
  label: string;
  /** Raw CNL source — preserve exact whitespace; the highlighter is
   *  whitespace-sensitive in the sense that it tokenizes per line. */
  source: string;
}

/**
 * Snippets are intentionally short (≤ 8 lines, ≤ 50 chars/line) so they
 * fit on mobile without horizontal scroll. The keywords here MUST match
 * the canonical lexicon (Module / Rule / has / given) — the whole point
 * is the marketing page renders real, compilable CNL.
 */
const SNIPPETS: readonly CnlSnippet[] = [
  {
    label: 'Loan eligibility',
    source: `Module aster.finance.loan.

Rule evaluate(applicant) given:
  applicant has income >= 50000 USD.
  applicant has credit_score >= 680.
  applicant has employment_years >= 2.
  decide approve.`,
  },
  {
    label: 'Compliance check',
    source: `Module aster.compliance.gdpr.

Rule may_process(record) given:
  record has consent = true.
  record has region in EU.
  decide allow with audit_trail.`,
  },
  {
    label: 'Workflow guard',
    source: `Module aster.ops.deploy.

Rule can_release(version) given:
  version has tests_passed = true.
  version has reviewers >= 2.
  decide release otherwise hold.`,
  },
] as const;

/** Typewriter timing tuned by trial: 18ms/char feels alive but readable. */
const CHAR_DELAY_MS = 18;
/** Time spent on a fully-typed snippet before erasing + advancing. */
const HOLD_MS = 4000;
/** Erase speed — faster than typing so the wait between snippets is short. */
const ERASE_DELAY_MS = 8;

export function CnlDemo({ className }: { className?: string }) {
  const [snippetIdx, setSnippetIdx] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [phase, setPhase] = useState<'typing' | 'hold' | 'erasing'>('typing');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snippet = SNIPPETS[snippetIdx];
  if (!snippet) {
    throw new Error('CnlDemo invariant: snippetIdx out of range');
  }

  // Reduced-motion users: skip the typing animation, render full snippets,
  // still cycle slowly so they see all three over time.
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      // Show each snippet fully for HOLD_MS * 2, then rotate.
      setTypedChars(snippet.source.length);
      const t = setTimeout(() => {
        setSnippetIdx((i) => (i + 1) % SNIPPETS.length);
      }, HOLD_MS * 2);
      return () => clearTimeout(t);
    }

    const step = () => {
      if (phase === 'typing') {
        if (typedChars < snippet.source.length) {
          setTypedChars((c) => c + 1);
          timerRef.current = setTimeout(step, CHAR_DELAY_MS);
        } else {
          setPhase('hold');
          timerRef.current = setTimeout(step, HOLD_MS);
        }
      } else if (phase === 'hold') {
        setPhase('erasing');
        timerRef.current = setTimeout(step, ERASE_DELAY_MS);
      } else if (phase === 'erasing') {
        if (typedChars > 0) {
          setTypedChars((c) => c - 1);
          timerRef.current = setTimeout(step, ERASE_DELAY_MS);
        } else {
          setSnippetIdx((i) => (i + 1) % SNIPPETS.length);
          setPhase('typing');
          timerRef.current = setTimeout(step, CHAR_DELAY_MS);
        }
      }
    };
    timerRef.current = setTimeout(step, CHAR_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [snippet.source, snippetIdx, typedChars, phase, prefersReducedMotion]);

  const displayed = snippet.source.slice(0, typedChars);

  return (
    <div
      className={cn(
        'mx-auto w-full max-w-2xl overflow-hidden',
        'rounded-xl border border-border bg-zinc-950 shadow-xl shadow-primary/10',
        className,
      )}
      aria-live="polite"
      aria-atomic="false"
    >
      {/* Window chrome — three macOS-style dots + label */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-rose-500/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-amber-400/70" aria-hidden />
          <span className="size-2.5 rounded-full bg-emerald-500/70" aria-hidden />
        </div>
        <span className="font-mono text-xs text-zinc-400">{snippet.label}</span>
        <span className="font-mono text-xs text-zinc-600">.aster</span>
      </div>

      {/* Code body */}
      <pre
        className="overflow-x-auto px-5 py-5 font-mono text-sm leading-relaxed"
        style={{
          // Lock minimum height so the card doesn't bounce as text types.
          // Tallest snippet has 8 lines × ~1.6rem = ~12.8rem. Pad a touch.
          minHeight: '14rem',
        }}
      >
        <code className="block whitespace-pre text-zinc-100">
          <Highlighted text={displayed} />
          {/* Blinking caret while typing or erasing */}
          {!prefersReducedMotion && phase !== 'hold' && (
            <span
              className="ml-0.5 inline-block w-[2px] animate-pulse bg-violet-400 align-middle"
              style={{ height: '1.1em' }}
              aria-hidden
            />
          )}
        </code>
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lightweight regex highlighter                                       */
/* ------------------------------------------------------------------ */

/**
 * Highlight one CNL line at a time.
 *
 * The rules deliberately match the colors of the production Monaco theme
 * (W4): Module/Rule = violet, has/given/in = sky, numbers = emerald,
 * decide/allow/approve/release = amber, comments = muted italic.
 *
 * This is *not* a full parser — it's a 60-LOC tokenizer that produces
 * the same visual impression as the real editor. If the source contains
 * unknown vocabulary it falls through as plain `zinc-100` text, which
 * is fine for the marketing snippets.
 */
function Highlighted({ text }: { text: string }) {
  // Tokenize per line so we can mix bold-keyword + neutral-text spans.
  // The display is whitespace-pre, so we emit '\n' as actual newlines.
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <span key={i}>
          <Tokens line={line} />
          {i < lines.length - 1 && '\n'}
        </span>
      ))}
    </>
  );
}

/** Token classes mirror the Monaco theme (W4). Hard-coded Tailwind
 *  utilities — the violet/sky/emerald/amber tokens are already defined
 *  by @theme in globals.css, but the *zinc shades* below come from
 *  Tailwind's built-in palette since this component is rendered on a
 *  dark surface and benefits from precise control. */
const STRUCTURAL = 'text-violet-300 font-semibold';
const RELATIONAL = 'text-sky-300';
const CONTROL    = 'text-amber-300 font-semibold';
const ACTION     = 'text-emerald-300 font-semibold';
const NUMBER     = 'text-emerald-300';
const COMMENT    = 'text-zinc-500 italic';

/**
 * Per-line tokenizer. The patterns are ordered: more-specific keywords
 * first, then numbers, then "the rest" as identifier text.
 */
function Tokens({ line }: { line: string }) {
  // Comment line short-circuit
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return <span className={COMMENT}>{line}</span>;
  }

  // Tokenize: split on word boundaries but keep separators in the output
  // so whitespace and punctuation render correctly.
  const parts = line.split(/(\b[A-Za-z_][A-Za-z0-9_]*\b|\d+(?:\.\d+)?)/);

  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        const cls = classify(part);
        if (cls) {
          return (
            <span key={i} className={cls}>
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

/** Token classification. Returns null for "plain identifier / punctuation". */
function classify(token: string): string | null {
  // Numbers
  if (/^\d/.test(token)) return NUMBER;

  // Structural keywords — Module / Rule definitions
  if (token === 'Module' || token === 'Rule') return STRUCTURAL;

  // Relational
  if (token === 'has' || token === 'given' || token === 'in') return RELATIONAL;

  // Control flow
  if (token === 'otherwise' || token === 'if' || token === 'then' || token === 'with') return CONTROL;

  // Action / decision verbs at end of rules
  if (
    token === 'decide' ||
    token === 'approve' ||
    token === 'allow' ||
    token === 'release' ||
    token === 'hold' ||
    token === 'audit_trail'
  ) {
    return ACTION;
  }

  return null;
}
