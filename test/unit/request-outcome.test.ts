import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { observeRequestOutcome } from '@/common/handlers/request-outcome.handler';

function fixture() {
  const req = Object.assign(new EventEmitter(), {
    method: 'GET',
    route: { path: '/items/:id' },
  });
  const res = Object.assign(new EventEmitter(), {
    writableFinished: false,
    headersSent: false,
    statusCode: 200,
  });
  const observe = (callback: Parameters<typeof observeRequestOutcome>[2]) =>
    observeRequestOutcome(
      req as unknown as Request,
      res as unknown as Response,
      callback,
    );

  return { req, res, observe };
}

afterEach(() => vi.restoreAllMocks());

describe('shared request outcomes', () => {
  it('shares one snapshot and listener set, then cleans up before notifying observers', () => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(100)
      .mockReturnValue(125.5);
    const { req, res, observe } = fixture();
    const first = vi.fn(() => {
      expect(req.listenerCount('aborted')).toBe(0);
      expect(res.listenerCount('finish')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
    });
    const second = vi.fn();

    observe(first);
    observe(second);
    expect(req.listenerCount('aborted')).toBe(1);
    expect(res.listenerCount('finish')).toBe(1);
    expect(res.listenerCount('close')).toBe(1);
    res.headersSent = true;
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
    req.emit('aborted');
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(second.mock.calls[0][0]).toEqual({
      outcome: 'completed',
      method: 'GET',
      route: '/items/:id',
      durationMs: 25.5,
      status: 200,
      headersSent: true,
    });
    const late = vi.fn();

    observe(late);
    expect(late.mock.calls[0][0]).toBe(second.mock.calls[0][0]);
  });

  it.each(['aborted', 'close'])(
    'settles an early %s once without inventing a response status',
    (event) => {
      const { req, res, observe } = fixture();
      const callback = vi.fn();

      observe(callback);
      (event === 'aborted' ? req : res).emit(event);
      req.emit('aborted');
      res.emit('close');
      res.writableFinished = true;
      res.emit('finish');
      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0][0]).toMatchObject({
        outcome: 'aborted',
        headersSent: false,
      });
      expect(callback.mock.calls[0][0]).not.toHaveProperty('status');
      expect(req.listenerCount('aborted')).toBe(0);
      expect(res.listenerCount('finish')).toBe(0);
      expect(res.listenerCount('close')).toBe(0);
    },
  );

  it('distinguishes incomplete writes from completed responses after headers were sent', () => {
    const { res, observe } = fixture();
    const callback = vi.fn();

    res.headersSent = true;
    observe(callback);
    res.emit('close');
    expect(callback.mock.calls[0][0]).toMatchObject({
      outcome: 'aborted',
      headersSent: true,
      status: 200,
    });
  });

  it('preserves unrelated listeners and does not add socket listeners across reused connections', () => {
    const socket = new EventEmitter();

    for (let index = 0; index < 50; index++) {
      const { req, res, observe } = fixture();
      const unrelated = vi.fn();

      Object.assign(req, { socket });
      res.on('close', unrelated);
      observe(vi.fn());
      res.writableFinished = true;
      res.emit('finish');
      expect(res.listeners('close')).toEqual([unrelated]);
      expect(req.listenerCount('aborted')).toBe(0);
    }
    expect(socket.eventNames()).toEqual([]);
  });

  it('bounds unsupported methods and non-string routes to fixed fallbacks', () => {
    const { req, res, observe } = fixture();
    const callback = vi.fn();

    Object.assign(req, {
      method: 'PRIVATE-METHOD',
      route: { path: /private/ },
    });
    observe(callback);
    res.writableFinished = true;
    res.emit('finish');
    expect(callback.mock.calls[0][0]).toMatchObject({
      method: '<other>',
      route: '<unmatched>',
    });
  });
});
