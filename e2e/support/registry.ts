// A minimal npm registry on localhost that serves one package from a local
// tarball. The launcher adds @londontypescript/temple-bar by name and
// version, which normally means the public registry; pointing
// npm_config_registry here lets it run for real, offline, before anything
// is published.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
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
const PUBLIC_REGISTRY = "https://registry.npmjs.org/";

// An npm package name, optionally scoped: nothing else is passed on, so
// the request to the public registry can only ever be a package lookup.
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

async function passThrough(
  name: string,
  accept: string | undefined,
  res: ServerResponse,
): Promise<void> {
  if (!PACKAGE_NAME.test(name)) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"not found"}');
    return;
  }
  try {
    const upstream = await fetch(
      new URL(encodeURIComponent(name), PUBLIC_REGISTRY),
      { headers: accept === undefined ? {} : { accept } },
    );
    // Finish the download before committing headers: a failed body must
    // return one 502 response, not throw while writing a second header.
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
    });
    res.end(body);
  } catch {
    res.writeHead(502, { "content-type": "application/json" });
    res.end('{"error":"the public registry could not be reached"}');
  }
}

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
      // Every other package (temple-bar's own dependencies) comes from the
      // public registry, as it would for a real install. Passing it through
      // here, rather than pointing only temple-bar's scope at this server,
      // works on every pnpm version: newer ones ignore a scope registry
      // given as an environment variable.
      void passThrough(pathname, req.headers.accept, res);
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
