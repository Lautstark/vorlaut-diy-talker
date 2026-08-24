#!/usr/bin/env node
// Whether what is in node_modules is what package.json pins.
//
//     node tools/installcheck.mjs
//
// This runs BEFORE the test suites rather than as one of their tests, and that
// placement is the whole point. A stale install does not announce itself: the
// four shared packages are git dependencies (docs/packages.md), nothing in the
// toolchain compares the installed copy with the pin, and the way it surfaces
// is as a test failing somewhere far away. tests/unit/level.test.ts is the one
// that showed it - it imports @lautstark/stimmquelle/browser and holds the
// recording chain against tests/reference/tts.lock.json, so an older
// stimmquelle produces a loudness failure with real numbers in it and a
// perfectly sensible story about limiters and ceilings, in code that is
// correct. That is worse than an error: it reads as a regression and gets
// investigated as one.
//
// So this says the true thing first, on its own, and stops. A failure among
// other failures is exactly the noise it exists to remove.
//
// It touches the network never, and resolves nothing. Everything compared here
// is metadata npm already wrote to disk:
//
//   package.json                              the pin a person typed, by tag
//   package-lock.json                         the pin npm resolved, by commit
//   node_modules/.package-lock.json           the commit actually installed
//   node_modules/<pkg>/package.json           the version actually on disk
//
// The last two are separate questions. npm's own record can say 2.7.0 while
// the directory holds 2.5.0 - that is what a half-finished install, a copied
// node_modules or a hand-edited package looks like - so the directory is asked
// directly and is the check that carries the most weight.
//
// There is deliberately no Python twin of this for tests/run.py. Two
// implementations of one rule drift, and this repository has paid for that
// before; run.py shells out to this file instead.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A stack trace here would be the second unreadable thing this file exists to
// prevent. Anything unforeseen comes out as one sentence and a non-zero exit,
// registered before the work below so a throw from it lands here too.
process.on("uncaughtException", (error) => {
  console.error(`\nThe install check could not run: ${error.message}\n`);
  process.exit(1);
});

/** A dependency npm fetches from git rather than from a registry. Matched by
 *  shape rather than by a list of names, so a fifth shared package is covered
 *  the day it is added and not the day somebody remembers this file. */
const GIT_SPEC = /^(github:|git\+|git:|gitlab:|bitbucket:)/;

/** A tag that names a version: "v2.7.0", "2.7.0", "1.0.0-rc.1". A pin by sha
 *  matches nothing here, which is correct - a sha says nothing about which
 *  version it is, and the lockfile is then the only opinion available. */
const VERSION_TAG = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

function readJson(path) {
  const text = readFileSync(join(ROOT, path), "utf-8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

function maybeJson(path) {
  try {
    return readJson(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** The version a git spec's ref names, or null where the ref is a sha or a
 *  branch. `github:Lautstark/stimmquelle#v2.7.0` -> `2.7.0`. */
function versionFromSpec(spec) {
  const hash = spec.indexOf("#");
  if (hash === -1) return null;
  const found = VERSION_TAG.exec(spec.slice(hash + 1));
  return found ? found[1] : null;
}

/** The commit out of a resolved git URL, or null. The lockfile writes these as
 *  `git+ssh://git@github.com/Lautstark/design.git#c1dbcf67...`. */
function commitFromResolved(resolved) {
  if (typeof resolved !== "string") return null;
  const hash = resolved.lastIndexOf("#");
  if (hash === -1) return null;
  const ref = resolved.slice(hash + 1);
  return /^[0-9a-f]{7,40}$/.test(ref) ? ref : null;
}

const short = (commit) => (commit ? commit.slice(0, 12) : "unknown");

const manifest = readJson("package.json");
const pinned = Object.entries({
  ...manifest.dependencies,
  ...manifest.devDependencies,
}).filter(([, spec]) => GIT_SPEC.test(spec));

// Nothing is pinned by git, so there is nothing here to be stale. Silence and
// zero: this must never become a reason a suite cannot run.
if (pinned.length === 0) process.exit(0);

const lockfile = maybeJson("package-lock.json");
// npm writes this on every install and it describes the tree that is actually
// there. Absent under another package manager, in which case the versions on
// disk still answer the question and only the commit comparison goes quiet.
const installedTree = maybeJson("node_modules/.package-lock.json");

/** Each problem carries its own fix, because the two are not the same repair:
 *  a node_modules behind the lockfile is an install that never happened, while
 *  a lockfile behind package.json is a pin somebody edited by hand. `npm ci`
 *  refuses the second outright, so recommending it there would send a person
 *  to a command that cannot work. */
const problems = [];

for (const [name, spec] of pinned) {
  const lockEntry = lockfile?.packages?.[`node_modules/${name}`];
  const specVersion = versionFromSpec(spec);
  const installed = maybeJson(`node_modules/${name}/package.json`);

  // Read as the pinned version: the lockfile where there is one, since that is
  // what `npm ci` installs, and otherwise the tag a person wrote.
  const pinnedVersion = lockEntry?.version ?? specVersion;

  if (!installed) {
    problems.push({
      name,
      lines: [
        `  pinned      ${pinnedVersion ?? "?"}   (${spec})`,
        `  installed   nothing   (node_modules/${name} is not there)`,
      ],
      fix: "npm ci",
    });
    continue;
  }

  if (lockfile && !lockEntry) {
    problems.push({
      name,
      lines: [
        `  pinned      ${spec}   (package.json)`,
        `  lockfile    no entry for node_modules/${name}`,
        `  installed   ${installed.version}`,
      ],
      fix: "npm install",
    });
    continue;
  }

  // package.json and the lockfile disagree. Whatever is installed, one of the
  // two pins is not being honoured, and which version is "right" is a question
  // only a person can answer - so it is named before the install is judged.
  if (specVersion && lockEntry && lockEntry.version !== specVersion) {
    problems.push({
      name,
      lines: [
        `  package.json      ${specVersion}   (${spec})`,
        `  package-lock.json ${lockEntry.version}`,
        `  installed         ${installed.version}`,
      ],
      fix: "npm install",
    });
    continue;
  }

  if (pinnedVersion && installed.version !== pinnedVersion) {
    problems.push({
      name,
      lines: [
        `  pinned      ${pinnedVersion}   (${spec})`,
        `  installed   ${installed.version}   (node_modules/${name})`,
      ],
      fix: "npm ci",
    });
    continue;
  }

  // Same version, different commit. A moved tag or a re-cut release looks like
  // this, and the version numbers alone would call it healthy.
  const pinnedCommit = commitFromResolved(lockEntry?.resolved);
  const installedCommit = commitFromResolved(
    installedTree?.packages?.[`node_modules/${name}`]?.resolved,
  );
  if (pinnedCommit && installedCommit && pinnedCommit !== installedCommit) {
    problems.push({
      name,
      lines: [
        `  pinned      ${pinnedVersion} at ${short(pinnedCommit)}   (package-lock.json)`,
        `  installed   ${pinnedVersion} at ${short(installedCommit)}   (same version, different commit)`,
      ],
      fix: "npm ci",
    });
  }
}

if (problems.length === 0 && lockfile) {
  const names = pinned.map(([name]) => name.replace(/^@lautstark\//, "")).join(", ");
  console.log(`Pinned packages match the lockfile: ${names}.`);
  process.exit(0);
}

// One fix, not one per package: `npm install` subsumes `npm ci` here, and a
// person told two commands has to work out which one comes first.
const fix = !lockfile || problems.some((problem) => problem.fix === "npm install")
  ? "npm install"
  : "npm ci";

const out = [];
out.push("");
// A missing lockfile is not a package being wrong, and counting it as one
// would put a number in the first line that nothing below it accounts for.
if (!lockfile) {
  out.push("NO LOCKFILE - package-lock.json is not there.");
  out.push("");
  out.push("Nothing states which commit of each git dependency this repository");
  out.push("expects, so only the tags in package.json are left to check against,");
  out.push("and nothing has checked which commit those point at.");
  out.push("");
}
if (problems.length > 0) {
  out.push(
    problems.length === 1
      ? "STALE INSTALL - one pinned package is not what is installed."
      : `STALE INSTALL - ${problems.length} pinned packages are not what is installed.`,
  );
  out.push("");
}
for (const problem of problems) {
  out.push(`${problem.name}`);
  out.push(...problem.lines);
  out.push("");
}
out.push("The tests were not run. They would have measured the installed");
out.push("version while naming the pinned one, and a failure of that kind reads");
out.push("exactly like a regression in code that is correct.");
out.push("");
out.push(`    ${fix}`);
out.push("");
out.push("and run them again.");
out.push("");

console.error(out.join("\n"));
process.exit(1);
