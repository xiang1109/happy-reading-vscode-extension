export interface FormattedStatusPage {
  text: string;
  end: number;
}

/**
 * VS Code 的原生 StatusBarItem 不提供固定 CSS 宽度。这里把半角 ASCII
 * 转成对应的全角字形，并用全角空格补齐，让中英文、数字和符号都占同一格。
 */
export function formatStatusPage(
  source: string,
  start: number,
  maximumEnd: number,
  cells: number
): FormattedStatusPage {
  const safeCells = Math.max(1, Math.floor(cells));
  // 原生 StatusBarItem 会在可用空间边缘裁切内容。最后固定保留一格
  // 全角空白，确保最右侧正文字符不会因字体实际宽度差异而消失。
  const contentCells = Math.max(1, safeCells - 1);
  const upperBound = Math.max(start, Math.min(maximumEnd, source.length));
  let end = Math.max(0, Math.min(start, source.length));
  const visible: string[] = [];

  while (end < upperBound && visible.length < contentCells) {
    const codePoint = source.codePointAt(end);
    if (codePoint === undefined) {
      break;
    }
    const character = String.fromCodePoint(codePoint);
    end += character.length;
    if (character !== '\r' && character !== '\n') {
      visible.push(toFullWidthCell(character));
    }
  }

  return {
    text: visible.join('') + '\u3000'.repeat(safeCells - visible.length),
    end: Math.max(end, Math.min(start + 1, source.length))
  };
}

export function statusCellCount(statusWidth: number): number {
  return Math.max(4, Math.floor((statusWidth - 80) / 12));
}

function toFullWidthCell(character: string): string {
  if (character === ' ' || character === '\t' || character === '\u00a0') {
    return '\u3000';
  }
  const codePoint = character.codePointAt(0);
  if (codePoint !== undefined && codePoint >= 0x21 && codePoint <= 0x7e) {
    return String.fromCodePoint(codePoint + 0xfee0);
  }
  return character;
}
