import { createServer, type RequestListener, type Server } from 'node:http';
import type { Env } from '@/config/env.config';
import type { RequestWorkTracker } from './request-lifecycle.handler';

export type ListenerPolicy = Pick<
  Env,
  | 'HTTP_HEADERS_TIMEOUT_MS'
  | 'HTTP_REQUEST_TIMEOUT_MS'
  | 'HTTP_DRAIN_TIMEOUT_MS'
>;

/** Owns transport deadlines, successful binding, and draining beyond response completion. */
export class HttpListener {
  public readonly server: Server;

  private starting: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private stopped = false;

  constructor(
    app: RequestListener,
    private readonly work: RequestWorkTracker,
    private readonly policy: ListenerPolicy,
  ) {
    this.server = createServer(
      {
        headersTimeout: policy.HTTP_HEADERS_TIMEOUT_MS,
        requestTimeout: policy.HTTP_REQUEST_TIMEOUT_MS,
        connectionsCheckingInterval: Math.max(
          1,
          Math.min(1_000, Math.floor(policy.HTTP_HEADERS_TIMEOUT_MS / 4)),
        ),
      },
      app,
    );
  }

  public isRunning(): boolean {
    return this.server.listening && !this.stopped;
  }

  public start(port: number, host = '0.0.0.0'): Promise<void> {
    if (this.stopped)
      return Promise.reject(new Error('HTTP startup interrupted by shutdown.'));

    if (this.starting) return this.starting;

    this.starting = new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        this.server.off('listening', listening);
        reject(error);
      };

      const listening = () => {
        this.server.off('error', failed);

        if (this.stopped) {
          this.server.close(() =>
            reject(new Error('HTTP startup interrupted by shutdown.')),
          );
        } else resolve();
      };

      this.server.once('error', failed);
      this.server.once('listening', listening);

      try {
        this.server.listen(port, host);
      } catch (error) {
        this.server.off('error', failed);
        failed(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return this.starting;
  }

  public quiesce(): void {
    this.stopped = true;
    this.work.accepting = false;
  }

  public close(): Promise<void> {
    this.quiesce();

    if (this.closing) return this.closing;

    let timer: NodeJS.Timeout;

    const graceful = async () => {
      await this.starting?.catch(() => undefined);

      if (this.server.listening) {
        await new Promise<void>((resolve, reject) => {
          this.server.close((error) => (error ? reject(error) : resolve()));
        });
      }

      // Closed sockets do not prove that awaited database/handler work has settled.
      await this.work.drain();
    };

    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.server.closeAllConnections();
        reject(
          new Error(
            'HTTP drain deadline exceeded; unfinished work may have an unknown outcome.',
          ),
        );
      }, this.policy.HTTP_DRAIN_TIMEOUT_MS);
    });

    this.closing = Promise.race([graceful(), deadline]).finally(() =>
      clearTimeout(timer),
    );

    return this.closing;
  }
}
