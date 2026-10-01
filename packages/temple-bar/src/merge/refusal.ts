// A refusal is a stop the user (or agent) must act on, with a message that
// says what to do. It is thrown from deep inside a step and caught once by
// the command, so each step can stop the whole merge without threading a
// result type through every function.

export class MergeRefusal extends Error {
  override readonly name = "MergeRefusal";
}

export function refuse(message: string): never {
  throw new MergeRefusal(message);
}
