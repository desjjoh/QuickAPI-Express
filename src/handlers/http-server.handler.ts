import type { Server } from 'node:http';

import { env } from '@/config/env-validation.config';
import { createApp } from '@/config/express.config';

export class HttpServerHandler {
  private static instance: Server | null = null;

  public static registerServer = async (): Promise<void> => {
    if (this.instance) return;

    const app = createApp();
    const server = app.listen(env.PORT);

    this.instance = server;
  };

  public static closeServer = (): void => {
    if (!this.instance) return;

    this.instance.close();
  };

  public static isServerRunning = (): boolean => {
    return this.instance !== null;
  };
}
