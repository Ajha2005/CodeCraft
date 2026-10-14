// Size limits shared by every endpoint that accepts code to run on demand.

/** Longest source file accepted, in characters. A solution to any problem here is a few hundred. */
export const MAX_CODE_CHARS = 20_000;

/** The languages the code runner can execute (see LANGUAGE_VERSIONS in the judge). */
export const SUPPORTED_LANGUAGES = ['python', 'c++'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
