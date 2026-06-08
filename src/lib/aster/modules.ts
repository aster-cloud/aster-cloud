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
// ADR 0015\uff1a\u4e09\u8bed Use/version/as \u5173\u952e\u8bcd\uff08lexicon: en Use/version/as\u3001zh \u5f15\u7528/\u7248\u672c/\u4f5c\u4e3a\u3001
// de verwende/version/als\uff09\u3002\u6355\u83b7\u7ec4\u987a\u5e8f\u4e0d\u53d8\uff1a1=keyword 2=module 3=version 4=alias\u3002
const USE_DECLARATION_RE =
  /(?:^|\s)(Use|\u5f15\u7528|verwende)\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*(?:\.[A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)*)(?:\s+(?:version|\u7248\u672c)\s+(\d+))?(?:\s+(?:as|\u4f5c\u4e3a|als)\s+([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*))?\s*[.\u3002]/iu;

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
