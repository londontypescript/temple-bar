// The only place domain code reads the current time, so tests can fake it.

export interface ClockSeam {
  now(): Date;
}

export function createClockSeam(): ClockSeam {
  return {
    now: () => new Date(),
  };
}
