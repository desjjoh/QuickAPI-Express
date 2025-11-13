declare global {
  namespace Express {
    interface Request {
      validated?: Record<string, unknown>;
    }
  }
}

export {};
