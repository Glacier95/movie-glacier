import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function writeReleaseChecksums(directory, version) {
  const installers = [
    `Movie.Glacier.Setup.${version}.exe`,
    ...['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(ext => `Movie.Glacier-${version}-mac-${arch}.${ext}`))
  ];
  for (const name of installers) {
    const file = path.join(directory, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
      throw new Error(`Missing or empty release installer: ${name}`);
    }
  }
  const allowed = new Set([...installers, ...installers.map(name => `${name}.blockmap`)]);
  const files = fs.readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt').sort();
  for (const name of files) {
    if (!allowed.has(name) || !fs.lstatSync(path.join(directory, name)).isFile()) {
      throw new Error(`Unexpected release artifact: ${name}`);
    }
  }
  const sums = [];
  for (const name of files) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(path.join(directory, name))) hash.update(chunk);
    sums.push(`${hash.digest('hex')}  ${name}`);
  }
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  try {
    const files = await writeReleaseChecksums(path.resolve(process.argv[2] || 'release'), version);
    console.log(`Verified ${files.length} release artifacts and wrote SHA256SUMS.txt.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
