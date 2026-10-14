import { SetMetadata } from '@nestjs/common';

export const NO_GUESTS_KEY = 'noGuests';
export const GUEST_CAN_WRITE_KEY = 'guestCanWrite';

/** Demo (guest) sessions get a 403 here even for GET: the route only makes sense for a real account. */
export const NoGuests = () => SetMetadata(NO_GUESTS_KEY, true);

/**
 * A route that changes state but that a demo session may still call. Writes are
 * closed to demo sessions unless a route says otherwise, so a new POST, PATCH
 * or DELETE is refused for them until someone decides it should not be.
 */
export const GuestCanWrite = () => SetMetadata(GUEST_CAN_WRITE_KEY, true);
