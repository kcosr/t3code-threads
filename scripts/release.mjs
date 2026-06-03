#!/usr/bin/env node
/**
 * Release script for t3code-threads.
 *
 * Usage:
 *   node scripts/release.mjs current
 *   node scripts/release.mjs patch
 *   node scripts/release.mjs minor
 *   node scripts/release.mjs major
 *   node scripts/release.mjs 0.2.3
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PACKAGE_NAME = "t3code-threads";
const REPO = process.env.GITHUB_REPOSITORY ?? "kcosr/t3code-threads";
const RELEASE_BRANCH = "main";
const RELEASE_ARG = process.argv[2];
const BUMP_ARGS = new Set(["major", "minor", "patch"]);
const VERSION_ARG = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const packageJsonPath = join(ROOT, "package.json");
const bunLockPath = join(ROOT, "bun.lock");
const changelogPath = join(ROOT, "CHANGELOG.md");

if (!RELEASE_ARG || (!BUMP_ARGS.has(RELEASE_ARG) && RELEASE_ARG !== "current" && !VERSION_ARG.test(RELEASE_ARG))) {
  console.error("Usage: node scripts/release.mjs <current|major|minor|patch|X.Y.Z>");
  process.exit(1);
}

function run(cmd, options = {}) {
  console.log(`$ ${cmd}`);
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: ROOT,
      ...options,
    });
  } catch {
    if (!options.ignoreError) {
      console.error(`Command failed: ${cmd}`);
      process.exit(1);
    }
    return null;
  }
}

function runFile(command, args, options = {}) {
  console.log(`$ ${[command, ...args.map((arg) => JSON.stringify(arg))].join(" ")}`);
  try {
    return execFileSync(command, args, {
      encoding: "utf-8",
      stdio: options.silent ? "pipe" : "inherit",
      cwd: ROOT,
      ...options,
    });
  } catch {
    if (!options.ignoreError) {
      console.error(`Command failed: ${command} ${args.join(" ")}`);
      process.exit(1);
    }
    return null;
  }
}

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf-8"));
}

function writePackageJson(packageJson) {
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf-8");
}

function getVersion() {
  const packageJson = readPackageJson();
  if (packageJson.name !== PACKAGE_NAME) {
    console.error(`Expected package name ${PACKAGE_NAME}, got ${packageJson.name}`);
    process.exit(1);
  }
  if (typeof packageJson.version !== "string" || !VERSION_ARG.test(packageJson.version)) {
    console.error("package.json version must be semantic X.Y.Z");
    process.exit(1);
  }
  return packageJson.version;
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    suffix: match[4] || "",
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}${parts.suffix}`;
}

function bumpVersion(currentVersion, bumpArg) {
  if (VERSION_ARG.test(bumpArg)) return bumpArg;
  const parts = parseVersion(currentVersion);
  if (!parts) {
    console.error(`Current version "${currentVersion}" is not valid semver`);
    process.exit(1);
  }
  if (bumpArg === "patch") {
    parts.patch += 1;
  } else if (bumpArg === "minor") {
    parts.minor += 1;
    parts.patch = 0;
  } else if (bumpArg === "major") {
    parts.major += 1;
    parts.minor = 0;
    parts.patch = 0;
  }
  parts.suffix = "";
  return formatVersion(parts);
}

function updatePackageVersion(newVersion) {
  const packageJson = readPackageJson();
  packageJson.version = newVersion;
  writePackageJson(packageJson);
}

function ensureCleanMain() {
  const branch = run("git branch --show-current", { silent: true }).trim();
  if (branch !== RELEASE_BRANCH) {
    console.error(`Error: releases must be run from ${RELEASE_BRANCH}; current branch is ${branch || "(detached)"}.`);
    process.exit(1);
  }
  const status = run("git status --porcelain", { silent: true });
  if (status?.trim()) {
    console.error("Error: Uncommitted changes detected. Commit or stash first.");
    console.error(status);
    process.exit(1);
  }
}

function ensureTools() {
  run("git --version", { silent: true });
  run("node --version", { silent: true });
  run("bun --version", { silent: true });
  run("gh --version", { silent: true });
}

function ensureTagAvailable(version) {
  const tagExists = run(`git rev-parse -q --verify refs/tags/v${version}`, {
    silent: true,
    ignoreError: true,
  });
  if (tagExists) {
    console.error(`Error: tag v${version} already exists.`);
    process.exit(1);
  }
}

function updateChangelogForRelease(version) {
  const date = new Date().toISOString().split("T")[0];
  let content = readFileSync(changelogPath, "utf-8");
  if (!content.includes("## [Unreleased]")) {
    console.error("Error: No [Unreleased] section found in CHANGELOG.md");
    process.exit(1);
  }
  if (content.includes(`## [${version}]`)) {
    console.error(`Error: CHANGELOG.md already contains a [${version}] section`);
    process.exit(1);
  }
  const unreleasedMatch = content.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[|$)/);
  if (!unreleasedMatch || unreleasedMatch[1].trim() === "_No unreleased changes._") {
    console.error("Error: CHANGELOG.md has no release notes under [Unreleased]");
    process.exit(1);
  }
  content = content.replace(/## \[Unreleased\]/, `## [${version}] - ${date}`);
  writeFileSync(changelogPath, content, "utf-8");
}

function extractReleaseNotes(version) {
  const content = readFileSync(changelogPath, "utf-8");
  const versionEscaped = version.replace(/\./g, "\\.");
  const regex = new RegExp(`## \\[${versionEscaped}\\][^\\n]*\\n([\\s\\S]*?)(?=\\n## \\[|$)`);
  const match = content.match(regex);
  if (!match) {
    console.error(`Error: Could not extract release notes for v${version}`);
    process.exit(1);
  }
  return match[1].trim();
}

function addUnreleasedSection() {
  let content = readFileSync(changelogPath, "utf-8");
  content = content.replace("# Changelog\n\n", "# Changelog\n\n## [Unreleased]\n\n_No unreleased changes._\n\n");
  writeFileSync(changelogPath, content, "utf-8");
}

const currentVersion = getVersion();
const version = RELEASE_ARG === "current" ? currentVersion : bumpVersion(currentVersion, RELEASE_ARG);

ensureCleanMain();
ensureTools();
ensureTagAvailable(version);

if (version !== currentVersion) {
  updatePackageVersion(version);
  run("bun install --lockfile-only");
}

run("bun run check");
updateChangelogForRelease(version);

const releaseFiles = ["package.json", "CHANGELOG.md"];
if (existsSync(bunLockPath)) releaseFiles.push("bun.lock");
runFile("git", ["add", ...releaseFiles]);
runFile("git", ["commit", "-m", `Release v${version}`]);
runFile("git", ["tag", `v${version}`]);
run("git push origin main");
run(`git push origin v${version}`);

const notes = extractReleaseNotes(version);
runFile("gh", ["release", "create", `v${version}`, "--repo", REPO, "--title", `v${version}`, "--notes", notes]);

addUnreleasedSection();
runFile("git", ["add", "CHANGELOG.md"]);
runFile("git", ["commit", "-m", "Open changelog for next cycle"]);
run("git push origin main");
