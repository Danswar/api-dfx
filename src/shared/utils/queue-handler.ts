import { Util } from './util';

class QueueItem<T> {
  private readonly timeout: NodeJS.Timeout;
  private readonly promise: Promise<T>;

  private resolve: (value: T | PromiseLike<T>) => void;
  private reject: (e: Error) => void;

  constructor(private readonly action: () => Promise<T>, timeout?: number) {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = (v) => {
        if (this.timeout) clearTimeout(this.timeout);
        resolve(v);
      };
      this.reject = (e) => {
        if (this.timeout) clearTimeout(this.timeout);
        reject(e);
      };
    });
    if (timeout) this.timeout = setTimeout(() => this.reject(new Error('Queue timeout')), timeout);
  }

  public wait(): Promise<T> {
    return this.promise;
  }

  public async doWork(timeout: number) {
    const promise = timeout ? Util.timeout(this.action(), timeout) : this.action();
    await promise.then(this.resolve).catch(this.reject);
  }

  public abort() {
    this.reject?.(new Error('Queue aborted'));
  }
}

export class QueueHandler {
  private readonly queue: QueueItem<any>[] = [];

  private isRunning = true;

  /**
   * @param queueTimeout Max. item in queue time (incl. execution time)
   * @param itemTimeout Max. item execution time
   */
  constructor(private readonly queueTimeout?: number, private readonly itemTimeout?: number) {
    void this.doWork();
  }

  async handle<T>(action: () => Promise<T>): Promise<T> {
    const item = new QueueItem(action, this.queueTimeout);
    this.queue.push(item);
    return item.wait();
  }

  clear() {
    for (const item of this.queue) {
      item.abort();
    }
  }

  stop() {
    this.isRunning = false;
  }

  private async doWork() {
    while (this.isRunning) {
      try {
        if (this.queue.length > 0) {
          await this.queue.shift().doWork(this.itemTimeout);
        } else {
          await Util.delay(10);
        }
      } catch {}
    }
  }
}
