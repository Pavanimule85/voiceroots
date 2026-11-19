export interface AlignmentToken {
  refWord: string | null;
  hypWord: string | null;
  op: 'match' | 'sub' | 'del' | 'ins';
}

export interface WerCerResult {
  wer: number;
  cer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  matches: number;
  referenceWords: number;
  hypothesisWords: number;
  referenceChars: number;
  charDistance: number;
  alignment: AlignmentToken[];
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[.,!?;:"'()\[\]{}।॥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computeWerCer(reference: string, hypothesis: string): WerCerResult {
  const refNorm = normalizeText(reference);
  const hypNorm = normalizeText(hypothesis);

  const refWords = refNorm ? refNorm.split(' ') : [];
  const hypWords = hypNorm ? hypNorm.split(' ') : [];

  const n = refWords.length;
  const m = hypWords.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  const ops: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i <= n; i++) {
    dp[i][0] = i;
    ops[i][0] = 2; // deletion
  }
  for (let j = 0; j <= m; j++) {
    dp[0][j] = j;
    ops[0][j] = 3; // insertion
  }
  ops[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
        ops[i][j] = 0;
      } else {
        const sub = dp[i - 1][j - 1] + 1;
        const del = dp[i - 1][j] + 1;
        const ins = dp[i][j - 1] + 1;
        if (sub <= del && sub <= ins) {
          dp[i][j] = sub;
          ops[i][j] = 1;
        } else if (del <= ins) {
          dp[i][j] = del;
          ops[i][j] = 2;
        } else {
          dp[i][j] = ins;
          ops[i][j] = 3;
        }
      }
    }
  }

  let i = n;
  let j = m;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let matches = 0;
  const reversedAlignment: AlignmentToken[] = [];

  while (i > 0 || j > 0) {
    const op = ops[i][j];
    if (op === 0) {
      matches++;
      reversedAlignment.push({ refWord: refWords[i - 1], hypWord: hypWords[j - 1], op: 'match' });
      i--;
      j--;
    } else if (op === 1) {
      substitutions++;
      reversedAlignment.push({ refWord: refWords[i - 1], hypWord: hypWords[j - 1], op: 'sub' });
      i--;
      j--;
    } else if (op === 2) {
      deletions++;
      reversedAlignment.push({ refWord: refWords[i - 1], hypWord: null, op: 'del' });
      i--;
    } else {
      insertions++;
      reversedAlignment.push({ refWord: null, hypWord: hypWords[j - 1], op: 'ins' });
      j--;
    }
  }

  const wordDist = dp[n][m];
  const wer = n > 0 ? Number(((wordDist / n) * 100).toFixed(2)) : 0;

  // Character-level Levenshtein
  const refChars = Array.from(refNorm.replace(/\s+/g, ''));
  const hypChars = Array.from(hypNorm.replace(/\s+/g, ''));
  const cn = refChars.length;
  const cm = hypChars.length;
  const cdp: number[][] = Array.from({ length: cn + 1 }, () => Array(cm + 1).fill(0));
  for (let x = 0; x <= cn; x++) cdp[x][0] = x;
  for (let y = 0; y <= cm; y++) cdp[0][y] = y;
  for (let x = 1; x <= cn; x++) {
    for (let y = 1; y <= cm; y++) {
      if (refChars[x - 1] === hypChars[y - 1]) {
        cdp[x][y] = cdp[x - 1][y - 1];
      } else {
        cdp[x][y] = 1 + Math.min(cdp[x - 1][y - 1], cdp[x - 1][y], cdp[x][y - 1]);
      }
    }
  }
  const charDistance = cdp[cn][cm];
  const cer = cn > 0 ? Number(((charDistance / cn) * 100).toFixed(2)) : 0;

  return {
    wer,
    cer,
    substitutions,
    deletions,
    insertions,
    matches,
    referenceWords: n,
    hypothesisWords: m,
    referenceChars: cn,
    charDistance,
    alignment: reversedAlignment.reverse(),
  };
}
