// The only place that makes network requests of its own (reading GitHub's
// public API with Node's built-in fetch). Kept behind a seam so tests never
// touch the network. It never throws: a failure to connect comes back as a
// value, so the caller decides what an unreachable API means.

export type HttpResult =
  | {
      readonly kind: "response";
      readonly status: number;
      readonly body: string;
    }
  /** No response at all: offline, DNS failure, timeout. */
  | { readonly kind: "network-error"; readonly message: string };

export interface HttpSeam {
  /** GET `url`, sending `token` as a bearer token when given. */
  get(url: string, token: string | undefined): Promise<HttpResult>;
}

const TIMEOUT_MS = 10_000;

export function createHttpSeam(): HttpSeam {
  return {
    async get(url, token) {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": "temple-bar",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (token !== undefined) {
        headers.Authorization = `Bearer ${token}`;
      }
      try {
        const response = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        return {
          kind: "response",
          status: response.status,
          body: await response.text(),
        };
      } catch (error) {
        return {
          kind: "network-error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
