/**
 * @/components/ui — single import surface for design-system primitives.
 *
 * Pages should import from here, NOT from the individual module files:
 *
 *   import { Button, Card, Stack } from '@/components/ui';
 *
 * Two consumption paths converge:
 *   - Button / Card / Wordmark — re-exported from @aster-cloud/ui
 *     (canonical source: aster-design-system on npm)
 *   - Input / Textarea / Label / Select / Badge / Alert / Skeleton /
 *     Separator / Stack / Container — local primitives that depend on
 *     aster-cloud-only idioms (Tailwind 4 @theme tokens, lucide icons).
 *
 * When a local primitive stabilizes and we want aster-lang-dev or another
 * future React surface to consume it, we promote it to @aster-cloud/ui in
 * a separate release.
 */
export { Button, buttonVariants, type ButtonProps } from './button';
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
} from './card';
export { Wordmark, type WordmarkProps } from './wordmark';

export { Input, type InputProps } from './input';
export { Textarea, type TextareaProps } from './textarea';
export { Label, type LabelProps } from './label';
export { Select, type SelectProps } from './select';

export { Badge, type BadgeProps } from './badge';
export {
  Alert, AlertTitle, AlertDescription, type AlertProps,
} from './alert';
export { Skeleton } from './skeleton';

export { Separator, type SeparatorProps } from './separator';
export { Stack, type StackProps } from './stack';
export { Container, type ContainerProps } from './container';
export {
  Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem,
} from './breadcrumbs';

export { cn } from './utils';
