export interface AsterSourceRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface UseRef {
  moduleName: string;
  version: number | null;
  alias: string | null;
  range: AsterSourceRange;
  moduleRange: AsterSourceRange;
  versionRange: AsterSourceRange | null;
}

const COMMENT_LINE_RE = /^\s*(?:\/\/|#)/;
// TODO(ADR-0015): Add zh/de Use equivalents once the canonical CNL lexicon names them.
const USE_DECLARATION_RE = /(?:^|\s)(Use)\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*(?:\.[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)*)(?:\s+version\s+(\d+))?(?:\s+as\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*))?\s*\./i;

function rangeFor(lineNumber: number, startOffset: number, length: number): AsterSourceRange {
  return {
    startLineNumber: lineNumber,
    startColumn: startOffset + 1,
    endLineNumber: lineNumber,
    endColumn: startOffset + length + 1,
  };
}

export function extractUseRefs(source: string): UseRef[] {
  const refs: UseRef[] = [];
  const lines = source.split(/\r\n|\r|\n/);

  lines.forEach((line, index) => {
    if (COMMENT_LINE_RE.test(line)) {
      return;
    }

    const match = USE_DECLARATION_RE.exec(line);
    if (!match || match.index === undefined) {
      return;
    }

    const keyword = match[1];
    const moduleName = match[2];
    const versionText = match[3] ?? null;
    const alias = match[4] ?? null;
    const declarationStart = match.index + match[0].lastIndexOf(keyword);
    const moduleStart = declarationStart + keyword.length + match[0].slice(match[0].lastIndexOf(keyword) + keyword.length).indexOf(moduleName);
    const versionStart = versionText === null ? -1 : line.indexOf(versionText, moduleStart + moduleName.length);

    refs.push({
      moduleName,
      version: versionText === null ? null : Number(versionText),
      alias,
      range: rangeFor(index + 1, declarationStart, match[0].trimEnd().length - match[0].slice(0, match[0].lastIndexOf(keyword)).length),
      moduleRange: rangeFor(index + 1, moduleStart, moduleName.length),
      versionRange: versionText === null ? null : rangeFor(index + 1, versionStart, versionText.length),
    });
  });

  return refs;
}
