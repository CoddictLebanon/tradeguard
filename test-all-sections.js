const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  const apiCalls = [];

  // Track errors
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('404')) {
      errors.push({ type: 'console', message: msg.text() });
    }
  });

  page.on('response', res => {
    if (res.url().includes('667')) {
      const endpoint = res.url().replace('http://localhost:667', '');
      apiCalls.push({ status: res.status(), endpoint });
      if (res.status() >= 400) {
        errors.push({ type: 'api', status: res.status(), endpoint });
      }
    }
  });

  console.log('=== TESTING ALL SECTIONS ===\n');

  // 1. Login
  console.log('1. LOGIN');
  await page.goto('http://localhost:666');
  await page.waitForLoadState('networkidle');
  await page.fill('input[type="email"]', 'admin@tradeguard.local');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button:has-text("Sign In")');
  await page.waitForURL('**/dashboard**', { timeout: 10000 });
  console.log('   ✓ Login successful\n');

  // 2. Dashboard
  console.log('2. DASHBOARD');
  await page.waitForTimeout(1000);
  const dashboardText = await page.textContent('body');
  if (dashboardText.includes('Dashboard') && dashboardText.includes('Trading Mode')) {
    console.log('   ✓ Dashboard loaded correctly');
  } else {
    console.log('   ✗ Dashboard has issues');
    errors.push({ type: 'page', section: 'dashboard', message: 'Content not loaded' });
  }
  await page.screenshot({ path: 'test-1-dashboard.png' });
  console.log('   Screenshot: test-1-dashboard.png\n');

  // 3. Opportunities
  console.log('3. OPPORTUNITIES');
  await page.click('text=Opportunities');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-2-opportunities.png' });
  const oppText = await page.textContent('body');
  console.log('   Screenshot: test-2-opportunities.png');
  if (oppText.includes('error') || oppText.includes('Error') || oppText.includes('failed')) {
    console.log('   ✗ Opportunities page has errors');
  } else {
    console.log('   ? Opportunities page loaded (check screenshot)');
  }
  console.log('');

  // 4. Positions
  console.log('4. POSITIONS');
  await page.click('text=Positions');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-3-positions.png' });
  const posText = await page.textContent('body');
  console.log('   Screenshot: test-3-positions.png');
  if (posText.includes('error') || posText.includes('Error') || posText.includes('failed')) {
    console.log('   ✗ Positions page has errors');
  } else {
    console.log('   ? Positions page loaded (check screenshot)');
  }
  console.log('');

  // 5. Watchlist
  console.log('5. WATCHLIST');
  await page.click('text=Watchlist');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-4-watchlist.png' });
  const watchText = await page.textContent('body');
  console.log('   Screenshot: test-4-watchlist.png');
  if (watchText.includes('error') || watchText.includes('Error') || watchText.includes('failed')) {
    console.log('   ✗ Watchlist page has errors');
  } else {
    console.log('   ? Watchlist page loaded (check screenshot)');
  }
  console.log('');

  // 6. Settings
  console.log('6. SETTINGS');
  await page.click('text=Settings');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-5-settings.png' });
  const settingsText = await page.textContent('body');
  console.log('   Screenshot: test-5-settings.png');
  if (settingsText.includes('error') || settingsText.includes('Error') || settingsText.includes('failed')) {
    console.log('   ✗ Settings page has errors');
  } else {
    console.log('   ? Settings page loaded (check screenshot)');
  }
  console.log('');

  // Summary
  console.log('=== SUMMARY ===');
  console.log('\nAPI Calls:');
  const uniqueEndpoints = [...new Set(apiCalls.map(c => `${c.status} ${c.endpoint}`))];
  uniqueEndpoints.forEach(e => console.log('  ' + e));

  console.log('\nErrors found:');
  if (errors.length === 0) {
    console.log('  None!');
  } else {
    const uniqueErrors = [...new Set(errors.map(e => JSON.stringify(e)))].map(e => JSON.parse(e));
    uniqueErrors.forEach(e => {
      if (e.type === 'api') {
        console.log(`  API ${e.status}: ${e.endpoint}`);
      } else {
        console.log(`  ${e.type}: ${e.message || e.section}`);
      }
    });
  }

  console.log('\nClosing browser in 5 seconds...');
  await page.waitForTimeout(5000);
  await browser.close();
})();
