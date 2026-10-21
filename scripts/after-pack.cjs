const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const locales = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(locales)) return;
  const keep = new Set(['en-US.pak', 'zh-CN.pak', 'zh-TW.pak']);
  for (const name of fs.readdirSync(locales)) {
    if (!name.endsWith('.pak') || keep.has(name)) continue;
    fs.unlinkSync(path.join(locales, name));
  }
  // Remove only files shipped by us; never recursively remove the install folder.
  const files = [], directories = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(context.appOutDir, absolute).replaceAll('/', '\\');
      if (relative === 'user-data' || relative.startsWith('user-data\\')) continue;
      if (entry.isDirectory()) { directories.push(relative); visit(absolute); }
      else files.push(relative);
    }
  }
  visit(context.appOutDir);
  const escape = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  const lines = files.map(file => `Delete "$INSTDIR\\${escape(file)}"`);
  // electron-builder adds its elevation helper after afterPack.
  lines.push('Delete "$INSTDIR\\resources\\elevate.exe"');
  lines.push('Delete "$INSTDIR\\${UNINSTALL_FILENAME}"');
  for (const dir of directories.sort((a, b) => b.length - a.length)) lines.push(`RMDir "$INSTDIR\\${escape(dir)}"`);
  fs.writeFileSync(path.join(context.packager.projectDir, 'build/uninstall-files.nsh'), lines.join('\n') + '\n');
};
