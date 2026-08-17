// dsh-sidebar-enhancement-search — Host half
// Serves three routes for the Explorer filter tab:
//   GET /dsh-sidebar-enhancement-search/index?cwd=     full recursive file index (cached)
//   GET /dsh-sidebar-enhancement-search/tree?cwd=&dir= one directory listing (lazy tree)
//   GET /dsh-sidebar-enhancement-search/reveal?cwd=&path= open the containing folder in the
//                                          OS file manager (explorer /select)
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, sep, basename, dirname } from "node:path";
import { spawn } from "node:child_process";

export const name = "dsh-sidebar-enhancement-search";

const IGNORE_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);
const MAX_INDEX_FILES = 30000;
const CACHE_TTL_MS = 30_000;

const cache = new Map(); // cwd -> { ts, files }

function trusted(req) {
  const host = String(req.headers.host || "");
  return host.startsWith("127.0.0.1:") || host.startsWith("localhost:");
}

function toPosix(p) {
  return p.split(sep).join("/");
}

function inside(root, target) {
  const base = resolve(root).toLowerCase();
  const abs = resolve(target).toLowerCase();
  return abs === base || abs.startsWith(base + sep);
}

function isDirSync(full) {
  try {
    return statSync(full).isDirectory();
  } catch {
    return false;
  }
}

/** Full recursive file index of cwd (files only, '/'-joined absolute paths). */
function walk(cwd) {
  const files = [];
  const stack = [cwd];
  const skip = (dir) => {
    const n = basename(dir);
    return IGNORE_DIRS.has(n) || n.startsWith(".");
  };
  while (stack.length > 0 && files.length < MAX_INDEX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (files.length >= MAX_INDEX_FILES) break;
      const full = join(dir, e.name);
      const isDir = e.isDirectory() || (e.isSymbolicLink() && isDirSync(full));
      if (isDir) {
        if (!skip(full)) stack.push(full);
      } else if (e.isFile() || e.isSymbolicLink()) {
        files.push(toPosix(full));
      }
    }
  }
  return files;
}

/** One directory listing (directories first, then files, both name-sorted). */
function listDir(cwd, dir) {
  const abs = resolve(cwd, dir);
  if (!inside(cwd, abs)) return null;
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries
    .map((e) => {
      const full = join(abs, e.name);
      const isDir = e.isDirectory() || (e.isSymbolicLink() && isDirSync(full));
      if (!isDir && !e.isFile() && !e.isSymbolicLink()) return null;
      return { name: e.name, path: toPosix(full), isDir, hidden: e.name.startsWith(".") };
    })
    .filter(Boolean)
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

function json(res, obj, status = 200) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

/** Resolve a session's working directory from the host sessions service. */
function sessionCwd(ctx, sessionId) {
  try {
    const s = ctx && ctx.sessions && ctx.sessions.get(sessionId);
    const cwd = s && s.header && s.header.cwd;
    if (typeof cwd === "string" && cwd.length > 0) return cwd;
  } catch (e) {}
  return "";
}

/** Open the containing folder of `path` (relative to cwd) in the OS file manager. */
function revealInExplorer(cwd, path, res) {
  if (process.platform !== "win32") return json(res, { ok: false, reason: "unsupported platform" });
  const abs = resolve(cwd, path);
  if (!inside(cwd, abs)) return json(res, { ok: false, reason: "outside workspace" });
  let target = abs;
  let select = true;
  try {
    if (statSync(target).isDirectory()) select = false;
  } catch {
    // missing: open the parent directory instead
    target = dirname(target);
    select = false;
  }
  try {
    // explorer.exe argument handling (verified 2026-08-18 with real window
    // titles): SELECT a file -> `/select,"path"` with windowsVerbatimArguments
    // (the default Node quoting would escape the inner quotes and explorer
    // would fail); OPEN a folder -> bare path with Node's DEFAULT quoting
    // (verbatim/quoted paths make explorer fall back to the Documents
    // folder instead of the requested one).
    const arg = select ? `/select,"${target}"` : target;
    const child = spawn("explorer.exe", [arg], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: !!select,
    });
    child.unref();
    console.log(`[dsh-sidebar-enhancement-search] reveal ${select ? "select" : "open"} ${target}`);
    return json(res, { ok: true, target });
  } catch (e) {
    return json(res, { ok: false, reason: String((e && e.message) || e) });
  }
}

export function apply(ctx) {
  const webServer = ctx.get("webServer");
  if (!webServer) return;
  const disposers = [];

  disposers.push(
    webServer.register({
      kind: "prefix",
      path: "/dsh-sidebar-enhancement-search",
      handler: (req, res) => {
        if (!trusted(req)) {
          res.writeHead(403);
          res.end("forbidden");
          return;
        }
        try {
          const url = new URL(req.url ?? "/", "http://dsh.internal");
          // Resolve the workspace root: prefer the session's own cwd (client
          // sends sessionId), fall back to an explicit cwd query param.
          const sessionId = url.searchParams.get("sessionId") || "";
          const cwd = sessionCwd(ctx, sessionId) || url.searchParams.get("cwd") || process.cwd();
          const route = url.pathname;
          if (route === "/dsh-sidebar-enhancement-search/index") {
            let entry = cache.get(cwd);
            const now = Date.now();
            if (!entry || now - entry.ts > CACHE_TTL_MS) {
              entry = { ts: now, files: walk(cwd) };
              cache.set(cwd, entry);
            }
            return json(res, { root: toPosix(resolve(cwd)), files: entry.files });
          }
          if (route === "/dsh-sidebar-enhancement-search/tree") {
            const dir = url.searchParams.get("dir") || cwd;
            const entries = listDir(cwd, dir);
            if (entries === null) return json(res, { error: "not found" }, 404);
            return json(res, { entries });
          }
          if (route === "/dsh-sidebar-enhancement-search/reveal") {
            const path = url.searchParams.get("path") || "";
            return revealInExplorer(cwd, path, res);
          }
          json(res, { error: "not found" }, 404);
        } catch (e) {
          json(res, { error: String((e && e.message) || e) }, 500);
        }
      },
    }),
  );

  return () => {
    for (const d of disposers) d();
  };
}

// Node's internal ESM loader returns the DEFAULT export only; 'webServer' is a
// hard dependency so apply runs only after the web server service exists.
export const inject = ["webServer"];
export default { name, apply, inject };
