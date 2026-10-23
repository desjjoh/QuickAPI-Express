import { createServer, connect, type Socket } from 'node:net';
import { portOf } from './http';

/** Disposable fault injector: the backend is real MySQL, with transport loss/stalls controlled here. */
export class MysqlProxy {
  public mode: 'forward' | 'offline' | 'stall' = 'forward';
  private readonly sockets = new Set<Socket>();
  public readonly server = createServer((client) => {
    if (this.mode === 'offline') {
      client.destroy();
      return;
    }
    const upstream = connect(this.port, this.host);
    this.sockets.add(client);
    this.sockets.add(upstream);
    client.on('data', (data) => {
      if (this.mode === 'forward') upstream.write(data);
    });
    upstream.on('data', (data) => {
      if (this.mode === 'forward') client.write(data);
    });
    const cleanup = () => {
      this.sockets.delete(client);
      this.sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
  });

  constructor(
    private readonly host: string,
    private readonly port: number,
  ) {}

  public async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', resolve);
    });
    return portOf(this.server);
  }

  public disconnect(): void {
    this.mode = 'offline';
    for (const socket of this.sockets) socket.destroy();
  }

  public async close(): Promise<void> {
    this.disconnect();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
