const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Enable console logging
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('BROWSER ERROR:', msg.text());
  });
  page.on('requestfailed', req => console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText));

  // Log API requests
  page.on('response', res => {
    if (res.url().includes('667')) {
      console.log('API:', res.status(), res.url().replace('http://localhost:667', ''));
    }
  });

  console.log('1. Navigating to login page...');
  await page.goto('http://localhost:666');
  await page.waitForLoadState('networkidle');

  console.log('2. Filling credentials...');
  await page.fill('input[type="email"]', 'admin@tradeguard.local');
  await page.fill('input[type="password"]', 'admin123');

  console.log('3. Clicking Sign In...');
  await page.click('button:has-text("Sign In")');

  // Wait for navigation
  await page.waitForURL('**/dashboard**', { timeout: 10000 }).catch(() => {});

  console.log('4. Current URL:', page.url());

  // Wait for dashboard to load
  await page.waitForTimeout(2000);

  // Check page content
  const pageText = await page.textContent('body');
  if (pageText.includes('Dashboard')) {
    console.log('5. SUCCESS: Dashboard loaded!');
  } else if (pageText.includes('error') || pageText.includes('Error')) {
    console.log('5. ERROR on page');
  }

  // Take screenshot
  await page.screenshot({ path: 'dashboard-screenshot.png' });
  console.log('6. Screenshot saved to dashboard-screenshot.png');

  console.log('\nKeeping browser open for 15 seconds...');
  await page.waitForTimeout(15000);

  await browser.close();
})();
