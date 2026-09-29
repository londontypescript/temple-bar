// A minimal npm registry on localhost that serves one package from a local
// tarball. The launcher adds @londontypescript/temple-bar by name and
// version, which normally means the public registry; pointing
// npm_config_registry here lets it run for real, offline, before anything
// is published.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface LocalRegistry {
  readonly url: string;
  /** Every package name the package manager asked for, in order. */
  readonly requested: string[];
  close(): Promise<void>;
}

interface PackageJson {
  readonly name: string;
  readonly version: string;
}

/** Serves `tarballPath` as `manifest.name@manifest.version`. `manifest` is
 * the package.json that was packed into the tarball. */
export function serveTarball(
  manifest: PackageJson & Record<string, unknown>,
  tarballPath: string,
): Promise<LocalRegistry> {
  const tarball = readFileSync(tarballPath);
  const shasum = createHash("sha1").update(tarball).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  const requested: string[] = [];

  let baseUrl = "";
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    ).slice(1);

    if (pathname === "tarball.tgz") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(tarball);
      return;
    }

    requested.push(pathname);
    if (pathname !== manifest.name) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end('{"error":"not found"}');
      return;
    }

    const packument = {
      name: manifest.name,
      "dist-tags": { latest: manifest.version },
      versions: {
        [manifest.version]: {
          ...manifest,
          _id: `${manifest.name}@${manifest.version}`,
          dist: { tarball: `${baseUrl}tarball.tgz`, shasum, integrity },
        },
      },
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(packument));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${String(port)}/`;
      resolve({
        url: baseUrl,
        requested,
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
