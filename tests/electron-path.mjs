import path from 'node:path';
import fs from 'node:fs';
import runtime from 'electron';

export function electronExecutable(packaged = process.env.FILM_LIBRARY_PACKAGED === '1') {
  if (process.env.FILM_LIBRARY_EXECUTABLE) return path.resolve(process.env.FILM_LIBRARY_EXECUTABLE);
  if (!packaged) return runtime;
  if (process.platform === 'darwin') {
    const manifest = path.resolve('.cache/mac-package.json');
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, 'utf8')).executable;
    return path.resolve(`release/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/Movie Glacier.app/Contents/MacOS/Movie Glacier`);
  }
  return path.resolve(process.platform === 'win32' ? 'release/win-unpacked/Movie Glacier.exe' : 'release/linux-unpacked/movie-glacier');
}
