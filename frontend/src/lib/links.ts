/** Link target that opens a problem on the Problems page. */
export const problemLink = (id: number) => ({ pathname: '/', search: `?problem=${id}` });

/** Router state that makes the problem page's Back button return to the page the link was on. */
export const FROM_BOARD = { fromBoard: true } as const;
