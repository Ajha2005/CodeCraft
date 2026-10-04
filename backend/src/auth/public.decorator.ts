import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const NO_GUESTS_KEY = 'noGuests';

/**
 * Opts a route out of the global "valid access token required" rule. If a
 * token does come with the request it is still read (so a route can tell who
 * is asking), but a missing or bad token is not an error.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Demo (guest) sessions get a 403 here even for GET: the route only makes sense for a real account. */
export const NoGuests = () => SetMetadata(NO_GUESTS_KEY, true);
