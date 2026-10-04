// Code drafts live in localStorage, one per user + problem + language, so a
// language switch, a refresh or a trip to another page never loses your work.
// Everything is best-effort: storage can be missing or full, and the editor
// must keep working regardless.

export type Language = 'python' | 'c++';

const draftKey = (userId: string, problemId: number, language: Language) => `cc.problems.draft.v1:${userId}:${problemId}:${language}`;
const LANGUAGE_KEY = 'cc.problems.lang.v1';

export function loadDraft(userId: string, problemId: number, language: Language): string | null {
  try {
    return localStorage.getItem(draftKey(userId, problemId, language));
  } catch {
    return null;
  }
}

/** Stores the code, or forgets the draft when it is just the starter template again. */
export function saveDraft(userId: string, problemId: number, language: Language, code: string, starter: string) {
  try {
    if (code === starter || code.trim() === '') localStorage.removeItem(draftKey(userId, problemId, language));
    else localStorage.setItem(draftKey(userId, problemId, language), code);
  } catch {
    // out of space or storage disabled: the draft just will not survive a reload
  }
}

export function loadLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'c++' ? 'c++' : 'python';
  } catch {
    return 'python';
  }
}

export function saveLanguage(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // ignore
  }
}
