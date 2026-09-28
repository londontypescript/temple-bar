// The only place domain code writes to the process's own stdout/stderr, so
// tests can fake them instead of capturing real streams.

export interface Writer {
  write(text: string): void;
}

export function createStdoutWriter(): Writer {
  return {
    write(text) {
      process.stdout.write(text);
    },
  };
}

export function createStderrWriter(): Writer {
  return {
    write(text) {
      process.stderr.write(text);
    },
  };
}
