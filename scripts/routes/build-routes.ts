/**
 * Generate `public/.well-known/routes.json` from `config/routes.yaml`.
 *
 * Why a separate generator:
 *   - The YAML is the human-editable source. JSON is the cross-repo
 *     consumable (Phase 3's link checker on aster-lang-dev will read
 *     this file). One source, one shape per consumer.
 *   - We commit BOTH files so CI can diff the generated JSON against
 *     the YAML and reject stale outputs. The generator's job is
 *     deterministic: same YAML in → same JSON out, no timestamps,
 *     no machine fingerprints.
 *
 * Determinism:
 *   - `generatedAt` is left null (the YAML's null, not Date.now()).
 *   - JSON keys are emitted in source order, not sorted, because the
 *     YAML's route order is curated for human review.
 *
 * Failure modes:
 *   - YAML missing or unparseable → exit 2
 *   - Schema validation errors → exit 1 with full report
 *   - Generated JSON differs from on-disk → caller (CI step) uses
 *     `git diff --exit-code` to detect, not this script.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { validateManifest, type RoutesManifest } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const YAML_PATH = resolve(REPO_ROOT, 'config', 'routes.yaml');
const JSON_PATH = resolve(REPO_ROOT, 'public', '.well-known', 'routes.json');

function fail(msg: string, code = 2): never {
  console.error(`::error::${msg}`);
  process.exit(code);
}

function main(): void {
  if (!existsSync(YAML_PATH)) {
    fail(`config/routes.yaml not found at ${YAML_PATH}`);
  }
  const yaml = readFileSync(YAML_PATH, 'utf8');
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (e) {
    fail(`routes.yaml is not valid YAML: ${(e as Error).message}`);
  }

  const { errors, warnings } = validateManifest(parsed);
  if (warnings.length > 0) {
    for (const w of warnings) console.warn(`::warning::${w}`);
  }
  if (errors.length > 0) {
    for (const err of errors) console.error(`::error::${err}`);
    process.exit(1);
  }

  // The generated JSON is the same shape as the YAML, with one
  // intentional difference: undefined optional fields are omitted
  // rather than serialised as `null`. That keeps the JSON minimal and
  // matches what `JSON.stringify` does with undefined-valued props.
  const manifest = parsed as RoutesManifest;
  const json = JSON.stringify(manifest, null, 2) + '\n';
  writeFileSync(JSON_PATH, json);
  console.log(`[build-routes] wrote ${JSON_PATH} (${manifest.routes.length} routes)`);
}

main();
