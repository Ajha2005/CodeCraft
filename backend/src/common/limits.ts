// Size limits shared by every endpoint that accepts code. The JSON body limit
// (64 KB, see app.setup.ts) is the outer wall; these are the readable ones.

/** Longest source file accepted, in characters. A solution to any problem here is a few hundred. */
export const MAX_CODE_CHARS = 20_000;

export const SUPPORTED_LANGUAGES = ['python', 'c++'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
