/** Drain active book operations before deleting an account. Ordinary operations
 * remain concurrent; only an admin deletion takes exclusive access. Includes
 * post-commit publication, not merely the database transaction callback. */
export class AccountDeletionGate {
  private halted = false;
  private readers = 0;
  private writer = false;
  private queue: { exclusive: boolean; resolve: () => void }[] = [];

  private acquire(exclusive: boolean): Promise<void> {
    return new Promise(resolve => {
      this.queue.push({ exclusive, resolve });
      this.drain();
    });
  }

  private drain() {
    if (this.writer) return;
    while (this.queue.length) {
      const next = this.queue[0];
      if (next.exclusive) {
        if (this.readers) return;
        this.writer = true;
        this.queue.shift()!.resolve();
        return;
      }
      this.readers++;
      this.queue.shift()!.resolve();
    }
  }

  async run<T>(exclusive: boolean, work: () => Promise<T>): Promise<T> {
    await this.acquire(exclusive);
    try {
      if (this.halted) throw new Error('Account deletion outcome requires reconciliation; restart after database recovery');
      return await work();
    }
    finally {
      if (exclusive) this.writer = false;
      else this.readers--;
      this.drain();
    }
  }

  /** An unknown COMMIT outcome must not let a stale book resume matching.
   * Startup recovery rebuilds books from the database before traffic resumes. */
  haltUntilRestart() { this.halted = true; }

  /** Bind internal calls to the original service to avoid nested leases. */
  guard<T extends object>(service: T, methods: (keyof T)[]): T {
    return new Proxy(service, {
      get: (target, property, receiver) => {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') return value;
        if (!methods.includes(property as keyof T)) return value.bind(target);
        return (...args: unknown[]) => this.run(false, () => value.apply(target, args));
      },
    });
  }
}
