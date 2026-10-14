// The run's log file. A run that did not fully pass keeps its log under logs\
// (outside the worktree, which is deleted); a clean run's is deleted. A step
// stops being logged at 50 MB so a runaway test can't fill the disk, though
// the terminal still gets everything. The logs kept are capped by count and
// size, oldest removed first.

import path from "node:path";

import { removeWithRetry, type FsLike } from "./fsx.ts";

const STEP_CAP_BYTES = 50 * 1024 * 1024;
const FLUSH_AT_BYTES = 32 * 1024;
const KEEP_LOGS = 10;
const KEEP_BYTES = 200 * 1024 * 1024;

export class RunLog {
  readonly #fs: FsLike;
  readonly #file: string;
  #pending = "";
  #chain: Promise<void> = Promise.resolve();
  #stepBytes = 0;
  #cut = false;
  #failure: string | undefined;

  constructor(fs: FsLike, file: string) {
    this.#fs = fs;
    this.#file = file;
  }

  /** Why the log could not be written, if it couldn't. */
  get problem(): string | undefined {
    return this.#failure;
  }

  startStep(title: string): void {
    this.#stepBytes = 0;
    this.#cut = false;
    this.#add(`== ${title}\n`);
  }

  line(text: string): void {
    if (this.#cut) {
      return;
    }
    const bytes = Buffer.byteLength(text) + 1;
    if (this.#stepBytes + bytes > STEP_CAP_BYTES) {
      this.#cut = true;
      this.#add("== output cut: this step's log reached 50 MB\n");
      return;
    }
    this.#stepBytes += bytes;
    this.#add(`${text}\n`);
  }

  #add(text: string): void {
    this.#pending += text;
    if (this.#pending.length >= FLUSH_AT_BYTES) {
      this.#enqueueFlush();
    }
  }

  #enqueueFlush(): void {
    const text = this.#pending;
    this.#pending = "";
    if (text === "") {
      return;
    }
    this.#chain = this.#chain.then(async () => {
      if (this.#failure !== undefined) {
        return;
      }
      try {
        await this.#fs.appendFile(this.#file, text);
      } catch {
        this.#failure = "the run's log could not be written";
      }
    });
  }

  async flush(): Promise<void> {
    this.#enqueueFlush();
    await this.#chain;
  }

  async delete(sleep: (ms: number) => Promise<void>): Promise<void> {
    await this.flush();
    await removeWithRetry(this.#fs, sleep, this.#file);
  }
}

/** Keeps at most 10 logs and 200 MB in all, removing the oldest first. */
export async function pruneLogs(
  fs: FsLike,
  sleep: (ms: number) => Promise<void>,
  dir: string,
): Promise<void> {
  const logs: { file: string; size: number; mtimeMs: number }[] = [];
  for (const name of await fs.readdir(dir)) {
    if (name.endsWith(".log")) {
      const file = path.join(dir, name);
      const info = await fs.lstat(file);
      logs.push({ file, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  logs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let total = 0;
  for (const [index, log] of logs.entries()) {
    total += log.size;
    if (index >= KEEP_LOGS || total > KEEP_BYTES) {
      await removeWithRetry(fs, sleep, log.file);
    }
  }
}
