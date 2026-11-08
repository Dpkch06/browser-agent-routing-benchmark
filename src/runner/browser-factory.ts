import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserEnvironment, BrowserFactory, BrowserSession } from './matrix.js';

export class PlaywrightBrowserFactory implements BrowserFactory {
  readonly #browser: Browser;
  readonly #playwrightVersion: string;

  constructor(args: { browser: Browser; playwrightVersion: string }) {
    this.#browser = args.browser;
    this.#playwrightVersion = args.playwrightVersion;
  }

  async createSession(): Promise<BrowserSession> {
    const context: BrowserContext = await this.#browser.newContext();
    try {
      const page: Page = await context.newPage();
      page.setDefaultNavigationTimeout(15_000);
      page.setDefaultTimeout(10_000);
      return {
        page,
        navigate: async (url) => {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
        },
        close: async () => {
          await context.close();
        },
      };
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  async getEnvironment(): Promise<BrowserEnvironment> {
    return {
      nodeVersion: process.version,
      playwrightVersion: this.#playwrightVersion,
      browser: 'chromium',
      browserVersion: this.#browser.version(),
    };
  }
}
