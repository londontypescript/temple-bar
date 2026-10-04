// A stand-in for GitHub's REST API on localhost, answering only what the
// judge reads: a pull request and its list of changed files. The installed
// judge is pointed at it through GITHUB_API_URL, the variable GitHub sets
// for its own Actions, so the packed judge runs for real without GitHub.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakePullRequest {
  readonly number: number;
  readonly files: readonly string[];
}

export interface FakeGithubApi {
  /** The API's base address, without a trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

export function serveFakeGithubApi(
  owner: string,
  repo: string,
  pullRequests: readonly FakePullRequest[],
): Promise<FakeGithubApi> {
  const server: Server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const match = new RegExp(
      `^/repos/${owner}/${repo}/pulls/(\\d+)(/files)?$`,
    ).exec(pathname);
    const pr = pullRequests.find(
      (entry) => String(entry.number) === match?.[1],
    );
    if (match === null || pr === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"message":"Not Found"}');
      return;
    }
    const body =
      match[2] === undefined
        ? {
            number: pr.number,
            head: { sha: "a".repeat(40) },
            base: { ref: "main" },
            changed_files: pr.files.length,
          }
        : pr.files.map((filename) => ({ filename, status: "modified" }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => {
              done();
            });
          }),
      });
    });
  });
}
