export interface ScannerEngine {
  readonly isScanning: boolean;
  start(onDecoded: (value: string) => void): Promise<unknown>;
  stop(): Promise<void>;
  scanFile(file: File): Promise<string>;
  clear(): void;
}

/** Serialize camera/photo work, including a camera permission request resolved after closing. */
export class ScannerSession {
  private engine: ScannerEngine | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private disposed = false;

  constructor(private load: () => Promise<ScannerEngine>, private releaseTracks: () => void = () => {}) {}

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(run);
    this.queue = result.catch(() => {});
    return result;
  }

  private current(generation: number) { return !this.disposed && generation === this.generation; }

  private async getEngine() {
    if (!this.engine) this.engine = await this.load();
    return this.engine;
  }

  private async stopEngine() {
    if (!this.engine) return;
    try {
      if (this.engine.isScanning) await this.engine.stop();
    } catch {
      // Release the actual MediaStream even if a browser/decoder stop fails.
    } finally {
      this.releaseTracks();
      try { this.engine.clear(); } catch { this.engine = null; }
    }
  }

  start(onDecoded: (value: string) => void): Promise<boolean> {
    const generation = ++this.generation;
    return this.enqueue(async () => {
      await this.stopEngine();
      if (!this.current(generation)) return false;
      const engine = await this.getEngine();
      if (!this.current(generation)) return false;
      try {
        await engine.start(value => { if (this.current(generation)) onDecoded(value); });
      } catch (error) {
        await this.stopEngine();
        if (!this.current(generation)) return false;
        throw error;
      }
      if (!this.current(generation)) { await this.stopEngine(); return false; }
      return true;
    });
  }

  read(file: File): Promise<string | null> {
    const generation = ++this.generation;
    return this.enqueue(async () => {
      await this.stopEngine();
      if (!this.current(generation)) return null;
      const engine = await this.getEngine();
      if (!this.current(generation)) return null;
      try {
        const code = await engine.scanFile(file);
        return this.current(generation) ? code : null;
      } finally {
        await this.stopEngine();
      }
    });
  }

  stop(): Promise<void> {
    ++this.generation;
    return this.enqueue(() => this.stopEngine());
  }

  destroy(): Promise<void> {
    this.disposed = true;
    return this.stop();
  }
}
