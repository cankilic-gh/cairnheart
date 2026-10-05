const BEST_KEY = 'cairnheart.best';

/** Best score is a per-browser convenience; storage may be blocked, so every access is guarded. */
export const loadBest = (): number => {
  try {
    return Number(window.localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
};

export const saveBest = (score: number): void => {
  try {
    window.localStorage.setItem(BEST_KEY, String(Math.round(score)));
  } catch {
    // private mode or blocked storage: best score simply is not kept
  }
};
