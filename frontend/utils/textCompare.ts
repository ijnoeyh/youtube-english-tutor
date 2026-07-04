// Listen 모드 받아쓰기 채점 유틸리티

export interface WordResult {
  word: string;
  status: "correct" | "wrong" | "missing";
}

export interface CompareResult {
  wordResults: WordResult[];
  score: number;
  matched: number;
  total: number;
}

// 대소문자·구두점 무시, 어퍼스트로피 보존 ("don't" → "don't")
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 정답 기준 위치별 1:1 대응으로 비교 (correct / wrong / missing)
export function compareTexts(original: string, userInput: string): CompareResult {
  const origWords = normalize(original).split(" ").filter(Boolean);
  const userWords = normalize(userInput).split(" ").filter(Boolean);

  let matched = 0;
  const wordResults: WordResult[] = origWords.map((origWord, i) => {
    const userWord = userWords[i];

    if (userWord === undefined) {
      return { word: origWord, status: "missing" };
    } else if (origWord === userWord) {
      matched++;
      return { word: origWord, status: "correct" };
    } else {
      return { word: origWord, status: "wrong" };
    }
  });

  const score =
    origWords.length > 0 ? Math.round((matched / origWords.length) * 100) : 0;

  return { wordResults, score, matched, total: origWords.length };
}
