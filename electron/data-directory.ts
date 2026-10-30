import fs from 'node:fs';
import path from 'node:path';

export function applicationDataDirectory(platform: NodeJS.Platform, packaged: boolean, appPath: string, executable: string, appData: string): string {
  if (packaged && platform === 'darwin') return path.join(appData, 'Movie Glacier');
  return path.join(packaged ? path.dirname(executable) : appPath, 'user-data');
}

/** Copy through a staging directory so an interrupted migration can be retried. */
export function prepareDataDirectory(target: string, legacyDirectories: string[]): void {
  fs.mkdirSync(target, { recursive: true });
  const probe = path.join(target, `.write-check-${process.pid}`);
  fs.writeFileSync(probe, '');
  fs.unlinkSync(probe);
  const marker = path.join(target, '.migration-complete');
  if (fs.existsSync(marker)) return;
  if (!fs.existsSync(path.join(target, 'library.sqlite'))) {
    const source = legacyDirectories.find(dir => path.resolve(dir) !== path.resolve(target) &&
      fs.existsSync(path.join(dir, 'library.sqlite')));
    if (source) {
      const staging = path.join(target, '.migration-staging');
      fs.mkdirSync(staging, { recursive: true });
      // Preserve Local State as well as cookies: it contains Chromium's encrypted key.
      for (const name of ['library.sqlite', 'images', 'Local State', 'Preferences', 'Local Storage', 'Partitions', 'Network']) {
        const from = path.join(source, name);
        if (fs.existsSync(from)) fs.cpSync(from, path.join(staging, name), { recursive: true, force: true });
      }
      // Publish the database last. Its presence must never signal a partial copy.
      for (const name of fs.readdirSync(staging).filter(name => name !== 'library.sqlite')) {
        fs.cpSync(path.join(staging, name), path.join(target, name), { recursive: true, force: true });
      }
      fs.renameSync(path.join(staging, 'library.sqlite'), path.join(target, 'library.sqlite'));
      // Both paths are fixed children of the verified target, never media roots.
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(marker, '1');
}
