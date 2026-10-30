import path from 'node:path';

export function playerCommand(platform: NodeJS.Platform, player: string, target: string): { executable: string; args: string[] } | null {
  if (player === 'system' || (!player && platform !== 'win32')) return null;
  if (platform === 'darwin' && path.extname(player).toLowerCase() === '.app')
    return { executable: '/usr/bin/open', args: ['-a', player, target] };
  return { executable: player, args: [target] };
}
