/**
 * Re-export of the Button primitive from the design system package.
 *
 * Why we don't inline the implementation: keeping the canonical source in
 * @aster-cloud/ui means a future aster-lang-dev-react / aster-lang-test-runner
 * gets the same component for free, and there's exactly one place to fix
 * accessibility issues, focus rings, or motion behavior.
 *
 * Why we *do* re-export through a local module: every consumer in this app
 * imports from "@/components/ui/button" (or the barrel). When a primitive
 * ever needs an aster-cloud-specific extension — e.g. a "loading" state
 * that talks to our toast system — we add it here without rippling import
 * changes through the codebase.
 */
export { Button, buttonVariants, type ButtonProps } from '@aster-cloud/ui';
