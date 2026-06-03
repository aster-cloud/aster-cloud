/**
 * Per-locale synonym maps for docs search.
 *
 * Each map keys lowercase aliases to a canonical lowercase form that
 * the search runtime then matches against entry title / headings /
 * description. The canonical form is typically the EN canonical
 * (since EN identifiers like "policy" / "audit" remain ASCII even in
 * zh/de docs), so the same map can be used to handle abbreviations
 * across locales.
 *
 * Keep entries minimal — every synonym is a search hit we promise to
 * deliver. Better to omit than to surface false positives.
 */

export type SynonymMap = Record<string, string>;

export const SYNONYMS_EN: SynonymMap = {
  // Authentication
  auth: 'authentication',
  signin: 'authentication',
  'sign-in': 'authentication',
  hmac: 'authentication',
  // Policy
  policies: 'policy',
  rule: 'policy',
  evaluate: 'policy',
  // Audit
  log: 'audit',
  logs: 'audit',
  trace: 'audit',
  traces: 'audit',
  // GraphQL / WebSocket
  gql: 'graphql',
  mutation: 'graphql',
  query: 'graphql',
  websockets: 'websocket',
  ws: 'websocket',
  // Common task synonyms
  start: 'quickstart',
  'getting-started': 'quickstart',
  install: 'quickstart',
};

export const SYNONYMS_ZH: SynonymMap = {
  // Map both English and Chinese spellings so a 中文 user typing
  // either form lands on the right page.
  auth: 'authentication',
  鉴权: 'authentication',
  认证: 'authentication',
  策略: 'policy',
  规则: 'policy',
  评估: 'policy',
  审计: 'audit',
  日志: 'audit',
  追踪: 'audit',
  快速开始: 'quickstart',
  开始: 'quickstart',
  入门: 'quickstart',
};

export const SYNONYMS_DE: SynonymMap = {
  auth: 'authentication',
  authentifizierung: 'authentication',
  anmeldung: 'authentication',
  richtlinie: 'policy',
  regeln: 'policy',
  auswertung: 'policy',
  protokoll: 'audit',
  protokolle: 'audit',
  einstieg: 'quickstart',
  schnellstart: 'quickstart',
  loslegen: 'quickstart',
};

export function synonymsFor(locale: string): SynonymMap {
  switch (locale) {
    case 'zh':
      return SYNONYMS_ZH;
    case 'de':
      return SYNONYMS_DE;
    case 'en':
    default:
      return SYNONYMS_EN;
  }
}
