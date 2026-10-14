import 'reflect-metadata';
import { NO_GUESTS_KEY } from '../auth/guest.decorators';
import { ContestController } from './contest.controller';

const guest = { user: { userId: 'guest:1', role: 'GUEST', isGuest: true } };
const account = { user: { userId: 'u1', role: 'USER', isGuest: false } };

function setup() {
  const service = {
    listIncoming: jest.fn().mockResolvedValue([{ id: 'in' }]),
    listOutgoing: jest.fn().mockResolvedValue([{ id: 'out' }]),
    listActive: jest.fn().mockResolvedValue([{ id: 'active' }]),
  };
  return { service, controller: new ContestController(service as never) };
}

describe('ContestController and demo (guest) sessions', () => {
  it('answers "no duels" to a guest without asking the service', async () => {
    const { service, controller } = setup();

    expect(await controller.listIncoming(guest)).toEqual([]);
    expect(await controller.listOutgoing(guest)).toEqual([]);
    expect(await controller.listActive(guest)).toEqual([]);

    expect(service.listIncoming).not.toHaveBeenCalled();
    expect(service.listOutgoing).not.toHaveBeenCalled();
    expect(service.listActive).not.toHaveBeenCalled();
  });

  it('still gives an account its own duels', async () => {
    const { service, controller } = setup();

    expect(await controller.listIncoming(account)).toEqual([{ id: 'in' }]);
    expect(await controller.listOutgoing(account)).toEqual([{ id: 'out' }]);
    expect(await controller.listActive(account)).toEqual([{ id: 'active' }]);

    expect(service.listIncoming).toHaveBeenCalledWith('u1');
  });

  it('closes a single duel to a guest even for GET', () => {
    expect(
      Reflect.getMetadata(
        NO_GUESTS_KEY,
        ContestController.prototype.getContest,
      ),
    ).toBe(true);
  });
});
