import fs from 'node:fs';

export async function withFileLock(filePath, fn) {
  const lockDir = `${filePath}.lock`;
  const maxWait = 30000; // 30 seconds
  const start = Date.now();
  
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() - start > maxWait) {
        throw new Error(`Timeout waiting for lock on ${filePath}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }
  }

  try {
    return await fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch (e) {}
  }
}
