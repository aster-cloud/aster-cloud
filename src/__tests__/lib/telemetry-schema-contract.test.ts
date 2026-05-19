// schema-contract (J4) unit tests — version predicate + invariants
// that prevent silent contract drift.

import { describe, it, expect } from 'vitest';
import {
  MAX_TELEMETRY_SCHEMA_VERSION,
  MIN_TELEMETRY_SCHEMA_VERSION,
  SUPPORTED_TELEMETRY_SCHEMA_VERSIONS,
  TELEMETRY_CONTRACT_BY_VERSION,
  TELEMETRY_FIELDS_V1,
  isSupportedSchemaVersion,
} from '@/lib/telemetry/schema-contract';

describe('isSupportedSchemaVersion', () => {
  it('accepts every listed version', () => {
    for (const v of SUPPORTED_TELEMETRY_SCHEMA_VERSIONS) {
      expect(isSupportedSchemaVersion(v)).toBe(true);
    }
  });

  it('rejects 0, negative, non-integer, and non-number inputs', () => {
    expect(isSupportedSchemaVersion(0)).toBe(false);
    expect(isSupportedSchemaVersion(-1)).toBe(false);
    expect(isSupportedSchemaVersion(99)).toBe(false);
    expect(isSupportedSchemaVersion('1')).toBe(false);
    expect(isSupportedSchemaVersion(null)).toBe(false);
    expect(isSupportedSchemaVersion(undefined)).toBe(false);
    expect(isSupportedSchemaVersion({})).toBe(false);
  });
});

describe('MIN / MAX boundaries', () => {
  it('MIN equals the smallest supported version', () => {
    expect(MIN_TELEMETRY_SCHEMA_VERSION).toBe(
      Math.min(...SUPPORTED_TELEMETRY_SCHEMA_VERSIONS),
    );
  });

  it('MAX equals the largest supported version', () => {
    expect(MAX_TELEMETRY_SCHEMA_VERSION).toBe(
      Math.max(...SUPPORTED_TELEMETRY_SCHEMA_VERSIONS),
    );
  });
});

describe('TELEMETRY_FIELDS_V1 contract invariants', () => {
  it('has a `schemaVersion` field marked required at v1', () => {
    const f = TELEMETRY_FIELDS_V1.find((x) => x.name === 'schemaVersion');
    expect(f).toBeDefined();
    expect(f?.required).toBe(true);
    expect(f?.since).toBe(1);
  });

  it('every required field carries a non-empty necessity statement (GDPR Art 5 evidence)', () => {
    for (const f of TELEMETRY_FIELDS_V1) {
      if (!f.required) continue;
      expect(f.necessity.length).toBeGreaterThan(20);
      expect(f.purpose.length).toBeGreaterThan(0);
    }
  });

  it('no two fields share the same name', () => {
    const names = TELEMETRY_FIELDS_V1.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('TELEMETRY_CONTRACT_BY_VERSION exposes each supported version', () => {
    for (const v of SUPPORTED_TELEMETRY_SCHEMA_VERSIONS) {
      const fields = TELEMETRY_CONTRACT_BY_VERSION[v];
      expect(fields).toBeDefined();
      expect(fields.length).toBeGreaterThan(0);
    }
  });
});
