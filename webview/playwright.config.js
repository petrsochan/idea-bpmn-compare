// Browser tests of the built diff view (../build/generated/webview/bpmn-compare), run by `npm run e2e`.
// Chromium, as the IDE shows the view in JCEF, which is Chromium too.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: '../build/e2e-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [ [ 'list' ], [ 'html', { outputFolder: '../build/reports/e2e', open: 'never' } ] ] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure'
  }
});
