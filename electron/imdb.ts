import { BrowserWindow, session } from 'electron';
import { parseImdbTop250, type ImdbChartEntry } from './imdb-chart.js';

let verificationWindow: BrowserWindow | null = null;

export async function openImdbVerification(): Promise<void> {
  if (verificationWindow && !verificationWindow.isDestroyed()) {
    verificationWindow.show(); verificationWindow.focus(); return;
  }
  const browser = new BrowserWindow({ width: 1060, height: 760, title: 'IMDb Top 250', webPreferences: {
    session: session.fromPartition('persist:metadata'), nodeIntegration: false, contextIsolation: true, sandbox: true
  } });
  verificationWindow = browser;
  browser.on('closed', () => { verificationWindow = null; });
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await browser.loadURL('https://www.imdb.com/chart/top/');
}

export async function fetchImdbTop250(): Promise<ImdbChartEntry[]> {
  // Share the configured metadata proxy and browser session. IMDb may require
  // JavaScript before returning its chart, so load it with Chromium like Douban.
  const network = session.fromPartition('persist:metadata');
  const browser = new BrowserWindow({ show: false, webPreferences: {
    session: network, nodeIntegration: false, contextIsolation: true, sandbox: true
  } });
  browser.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await browser.loadURL('https://www.imdb.com/chart/top/');
        for (let attempt = 0; attempt < 24; attempt++) {
          const html = await browser.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('script#__NEXT_DATA__, script[type="application/ld+json"]'), script => script.outerHTML).join('')`
          ) as string;
          try { return parseImdbTop250(html); }
          catch { await new Promise(resolve => setTimeout(resolve, 500)); }
        }
        throw new Error('IMDb Top 250 榜单不完整或需要访问验证，请在设置中打开 IMDb 完成验证后重试');
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('IMDb Top 250 加载超时，请检查网络或代理')), 25_000); })
    ]);
  } finally {
    clearTimeout(timer);
    if (!browser.isDestroyed()) browser.destroy();
  }
}
