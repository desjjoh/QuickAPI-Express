import { connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function portOf(server: Server): number {
  return (server.address() as AddressInfo).port;
}

/** A raw socket exercises Node's parser timeouts, before Express receives a request. */
export function rawRequest(
  server: Server,
  payload: string,
): { socket: Socket; response: Promise<string> } {
  const socket = connect(portOf(server), '127.0.0.1');
  const response = new Promise<string>((resolve, reject) => {
    let result = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Raw HTTP request did not close.'));
    }, 3_000);
    socket.on('data', (data) => {
      result += data.toString();
    });
    socket.once('connect', () => socket.write(payload));
    socket.once('error', reject);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(result);
    });
  });
  return { socket, response };
}
