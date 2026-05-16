/**
 * Single import surface for SWR-backed data hooks.
 *
 *   import { useApi, useMutation, ApiError } from '@/lib/api';
 *
 * Use useApi for cached reads (GET). Use useMutation for writes
 * (POST/PUT/PATCH/DELETE) where you also want to revalidate the
 * relevant useApi caches after success.
 */
export { useApi, apiFetch, ApiError, type UseApiResult } from './use-api';
export {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from './use-mutation';
