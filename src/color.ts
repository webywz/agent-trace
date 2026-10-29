export interface Palette {
  enabled: boolean;
  bold: (s: string) => string;
  dim: (s: string) => string;
  italic: (s: string) => string;
  red: (s: string) => string;
  green: (s: string) => string;
  yellow: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
  inverse: (s: string) => string;
}

function wrap(enabled: boolean, open: string, close: string): (s: string) => string {
  return (s: string) => (enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s);
}

export function createPalette(enabled: boolean): Palette {
  return {
    enabled,
    bold: wrap(enabled, "1", "22"),
    dim: wrap(enabled, "2", "22"),
    italic: wrap(enabled, "3", "23"),
    red: wrap(enabled, "91", "39"),
    green: wrap(enabled, "32", "39"),
    yellow: wrap(enabled, "33", "39"),
    cyan: wrap(enabled, "36", "39"),
    magenta: wrap(enabled, "35", "39"),
    inverse: wrap(enabled, "7", "27"),
  };
}

export function shouldColor(flag?: boolean): boolean {
  if (flag === false) return false;
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (flag === true) return true;
  return Boolean(process.stdout.isTTY);
}
