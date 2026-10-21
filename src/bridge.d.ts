import type { Bridge } from './shared';

declare global {
  const __APP_VERSION__: string;
  interface Window { library: Bridge }
}
