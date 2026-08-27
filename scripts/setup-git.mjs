#!/usr/bin/env node
/*
  Registers the sync-json merge driver in THIS clone's .git/config.

  .gitattributes can NAME a merge driver but cannot define one — git
  deliberately will not execute a program a repository supplies, or cloning a
  repo would be code execution. So every clone runs this once.

  Idempotent, and safe to run from a postinstall hook: it does nothing
  outside a git work tree (CI checkouts, tarballs, Docker builds).
*/
import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

try {
  git('rev-parse', '--is-inside-work-tree');
} catch {
  process.exit(0); // not a git checkout; nothing to configure
}

const DRIVER = 'node scripts/merge-sync-json.mjs %O %A %B %P';
let existing = '';
try { existing = git('config', '--get', 'merge.sync-json.driver'); } catch { /* unset */ }

if (existing === DRIVER) {
  console.log('[setup-git] sync-json merge driver already registered.');
  process.exit(0);
}

git('config', 'merge.sync-json.name', 'Per-document merge for synced data files');
git('config', 'merge.sync-json.driver', DRIVER);
console.log(
  '[setup-git] Registered the sync-json merge driver.\n' +
    '            src/data/{videos,articles,instagram,article-images}.json will now\n' +
    '            merge per document instead of conflicting wholesale. It still stops\n' +
    '            and asks whenever an editorial field disagrees.',
);
