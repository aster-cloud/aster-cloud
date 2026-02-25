import { PlanType } from '@/lib/plans';

// User types
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  plan: Plan;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Plan = PlanType;

// Policy types
export interface Policy {
  id: string;
  userId: string;
  name: string;
  content: string;
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Execution types
export interface Execution {
  id: string;
  userId: string;
  policyId: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  durationMs: number;
  createdAt: Date;
}

// Feature gates
