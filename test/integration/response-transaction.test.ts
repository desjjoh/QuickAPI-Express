import express from 'express';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AppDataSource } from '@/config/database.config';
import { jsonHandler } from '@/common/handlers/http-response.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { ItemService } from '@/api/v1/items/services/items.service';
import { ItemRepository } from '@/database/repositories/item.repo';
import { itemService } from '@/api/v1/items/services/items.service';
import { itemRepository } from '@/database/repositories/item.repo';
import { toItemDTO } from '@/api/v1/items/models/item.model';
import type { ItemEntity } from '@/database/entities/_item.entity';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterEach(() => vi.restoreAllMocks());
afterAll(disconnectTestDatabase);

function fixture() {
  const app = express();
  const work = new RequestWorkTracker();
  app.use(work.admit, requestTimeout(1000));
  return { app, work };
}
async function rows() {
  return AppDataSource.query('SELECT * FROM items ORDER BY id');
}

describe('real MySQL transactional response preparation', () => {
  it.each(
    (['create', 'update', 'replace', 'remove'] as const).flatMap((method) =>
      (['DTO', 'serialization'] as const).map((failure) => ({
        method,
        failure,
      })),
    ),
  )(
    'rolls back $method when $failure fails after the service returns',
    async ({ method, failure }) => {
      const original = await itemRepository.create({
        name: 'Original',
        price: 5,
      });
      const before = await rows();
      const { app } = fixture();
      const operation = () => {
        if (method === 'create')
          return itemService.create({ body: { name: 'New', price: 6 } });
        if (method === 'remove')
          return itemService.remove({
            params: { id: original.id },
            body: { expected_version: original.version },
          });
        return itemService[method]({
          params: { id: original.id },
          body: {
            name: 'Changed',
            price: 7,
            expected_version: original.version,
          },
        });
      };
      const map = vi.fn((item: ItemEntity) => {
        if (failure === 'DTO') return toItemDTO({ ...item, name: '' });
        const body = { item: toItemDTO(item), circular: {} };
        body.circular = body;
        return body;
      });
      app.post('/', jsonHandler(operation, map, { transaction: true }));
      app.use(errorHandler);
      const response = await request(app).post('/');
      expect(response.status).toBe(500);
      expect(response.body.message).toBe(
        failure === 'DTO'
          ? 'Failed to validate response DTO'
          : 'Internal Server Error',
      );
      expect(map).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(before);
      // A rolled-back request must not poison the next transaction or retain its lease.
      await itemService.create({ body: { name: 'Recovered', price: 8 } });
      expect(await rows()).toHaveLength(2);
    },
  );

  it.each([true, false])(
    'shares one transaction across multiple service calls (valid response: %s)',
    async (valid) => {
      const { app } = fixture();
      const transaction = vi.spyOn(AppDataSource.manager, 'transaction');
      const create = vi.spyOn(itemRepository, 'create');
      const otherRepository = new ItemRepository();
      const otherService = new ItemService(otherRepository);
      const otherCreate = vi.spyOn(otherRepository, 'create');
      app.post(
        '/',
        jsonHandler(
          async () => {
            await itemService.create({ body: { name: 'First', price: 1 } });
            return otherService.create({ body: { name: 'Second', price: 2 } });
          },
          (item) => toItemDTO(valid ? item : { ...item, name: '' }),
          { transaction: true, status: 201 },
        ),
      );
      app.use(errorHandler);
      const response = await request(app).post('/');
      expect(response.status).toBe(valid ? 201 : 500);
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(1);
      expect(otherCreate).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][1]).toBe(otherCreate.mock.calls[0][1]);
      expect(create.mock.calls[0][1]?.queryRunner?.isReleased).toBe(true);
      expect(await rows()).toHaveLength(valid ? 2 : 0);
    },
  );

  it('rolls back all earlier service steps when a later service operation fails', async () => {
    const { app } = fixture();
    app.post(
      '/',
      jsonHandler(
        async () => {
          await itemService.create({ body: { name: 'First', price: 1 } });
          return itemService.remove({
            params: { id: 'abcdefghijklmnop' },
            body: { expected_version: 1 },
          });
        },
        toItemDTO,
        { transaction: true },
      ),
    );
    app.use(errorHandler);
    expect((await request(app).post('/')).status).toBe(404);
    expect(await rows()).toHaveLength(0);
  });

  it('prepares standard JSON matching the default Express response', async () => {
    const { app } = fixture();
    const body = {
      name: '<tag>&',
      optional: undefined,
      time: new Date('2026-01-01'),
    };
    app.post(
      '/transaction',
      jsonHandler(
        () => body,
        (value) => value,
        { transaction: true },
      ),
    );
    app.post(
      '/ordinary',
      jsonHandler(
        () => body,
        (value) => value,
      ),
    );
    app.use(errorHandler);
    const transactional = await request(app).post('/transaction');
    const ordinary = await request(app).post('/ordinary');
    expect(transactional.status).toBe(200);
    expect(transactional.text).toBe(ordinary.text);
    expect(transactional.headers['content-type']).toBe(
      ordinary.headers['content-type'],
    );
  });
});
