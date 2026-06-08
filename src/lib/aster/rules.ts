export interface RuleSymbolRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface RuleSymbol {
  name: string;
  isEntry: boolean;
  range: RuleSymbolRange;
}

const RULE_DECLARATION_RE = /(?:^|\s)(Rule|规则|Regel)\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff.]*)/i;
const COMMENT_LINE_RE = /^\s*(?:\/\/|#)/;
const ENTRY_RE = /(?:^|\s)@entry(?:\s|$)/i;

export function extractRuleSymbols(source: string): RuleSymbol[] {
  const rules: RuleSymbol[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    if (COMMENT_LINE_RE.test(line)) {
      return;
    }

    const match = RULE_DECLARATION_RE.exec(line);
    if (!match || match.index === undefined) {
      return;
    }

    const keyword = match[1];
    const name = match[2];
    const ruleStartOffset = match.index + match[0].lastIndexOf(keyword);
    const nameStartOffset = ruleStartOffset + keyword.length + match[0].slice(match[0].lastIndexOf(keyword) + keyword.length).indexOf(name);

    rules.push({
      name,
      isEntry: ENTRY_RE.test(line.slice(0, ruleStartOffset)),
      range: {
        startLineNumber: index + 1,
        startColumn: nameStartOffset + 1,
        endLineNumber: index + 1,
        endColumn: nameStartOffset + name.length + 1,
      },
    });
  });

  return rules;
}

export function chooseDefaultRule(rules: Pick<RuleSymbol, 'name' | 'isEntry'>[]): string | null {
  const entryRules = rules.filter((rule) => rule.isEntry);

  if (entryRules.length === 1) {
    return entryRules[0].name;
  }

  if (rules.length === 1) {
    return rules[0].name;
  }

  return null;
}
