import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { TerritoryController } from './territory.controller';

describe('TerritoryController', () => {
  const proto = TerritoryController.prototype;
  const routes = Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({
      name,
      path: Reflect.getMetadata(PATH_METADATA, proto[name as keyof typeof proto]),
      method: Reflect.getMetadata(METHOD_METADATA, proto[name as keyof typeof proto]),
      isPublic: Reflect.getMetadata(IS_PUBLIC_KEY, proto[name as keyof typeof proto]) === true,
    }));

  it('exposes exactly the zone list, the static grid and the per-viewer owners', () => {
    expect(routes.map((r) => `${RequestMethod[r.method]} ${r.path}`).sort()).toEqual(['GET /', 'GET grid', 'GET owners']);
  });

  it('keeps only the zone list public (the login page counts the zones); the grid and owners need a token', () => {
    expect(routes.filter((r) => r.isPublic).map((r) => r.name)).toEqual(['findAll']);
  });

  it('hands the viewer to the owners query, so isMe is decided on the server', async () => {
    const service = { owners: jest.fn().mockResolvedValue({ owners: [], held: [], gridVersion: 2 }), grid: jest.fn(), findAll: jest.fn() };
    const controller = new TerritoryController(service as never);
    const viewer = { userId: 'u1', role: 'USER' as const, isGuest: false };
    await controller.owners(viewer);
    expect(service.owners).toHaveBeenCalledWith(viewer);
  });
});
