import { connect, createServer, type Socket } from 'node:net';
import { deferred, portOf } from './http';

type Interception = {
  match: RegExp;
  phase: 'before-query' | 'before-result';
  observed: ReturnType<typeof deferred<string>>;
  resume?: () => void;
  disconnect?: () => void;
};

/** Test-only, unencrypted COM_QUERY transport gate. No SQL, driver, or repository is mocked. */
export class MysqlQueryProxy {
  private readonly sockets = new Set<Socket>();
  private interception?: Interception;
  private offline = false;
  public readonly queries: string[] = [];

  private readonly server = createServer((client) => {
    if (this.offline) {
      client.destroy();
      return;
    }
    const upstream = connect(this.port, this.host);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    let pending = Buffer.alloc(0);
    let holdResult = false;
    const results: Buffer[] = [];
    this.sockets.add(client);
    this.sockets.add(upstream);
    const cleanup = () => {
      this.sockets.delete(client);
      this.sockets.delete(upstream);
      client.destroy();
      upstream.destroy();
      results.length = 0;
    };
    client.on('error', cleanup);
    upstream.on('error', cleanup);
    client.on('close', cleanup);
    upstream.on('close', cleanup);
    client.on('data', (data) => {
      pending = Buffer.concat([pending, data]);
      // TCP chunks need not align with MySQL packets. Forward complete packets,
      // including handshakes, unchanged; intercept only COM_QUERY (command 0x03).
      while (pending.length >= 4) {
        const length = pending.readUIntLE(0, 3) + 4;
        if (pending.length < length) break;
        const packet = pending.subarray(0, length);
        pending = pending.subarray(length);
        // mysql2/MySQL 8 may prefix SQL with the negotiated zero-attribute
        // counts (0 parameters, 1 parameter set). Forward original bytes intact.
        const sqlOffset = packet[5] === 0 && packet[6] === 1 ? 7 : 5;
        const sql =
          packet[3] === 0 && packet[4] === 3
            ? packet.subarray(sqlOffset).toString()
            : '';
        if (sql) this.queries.push(sql);
        const gate = this.interception;
        if (sql && gate?.match.test(sql)) {
          this.interception = undefined;
          gate.disconnect = cleanup;
          if (gate.phase === 'before-query') {
            gate.resume = () => upstream.write(packet);
          } else {
            holdResult = true;
            gate.resume = () => {
              holdResult = false;
              for (const result of results.splice(0)) client.write(result);
            };
            upstream.write(packet);
          }
          gate.observed.resolve(sql);
        } else upstream.write(packet);
      }
    });
    upstream.on('data', (data) => {
      if (holdResult) results.push(data);
      else client.write(data);
    });
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

  public intercept(match: RegExp, phase: Interception['phase']) {
    if (this.interception)
      throw new Error('A query interception is already armed');
    const gate: Interception = { match, phase, observed: deferred<string>() };
    this.interception = gate;
    return {
      observed: gate.observed.promise,
      resume: () => {
        if (this.interception === gate) this.interception = undefined;
        gate.resume?.();
      },
      disconnect: () => {
        if (this.interception === gate) this.interception = undefined;
        gate.disconnect?.();
      },
    };
  }

  public disconnect(): void {
    this.offline = true;
    this.interception = undefined;
    for (const socket of this.sockets) socket.destroy();
  }

  public recover(): void {
    this.offline = false;
  }

  public async close(): Promise<void> {
    this.disconnect();
    if (!this.server.listening) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
