import { test, expect } from '@playwright/test';

test.describe('Trading App Tests', () => {
  test('can login and view dashboard', async ({ page }) => {
    await page.goto('http://localhost:666/login');

    // Use id selectors which are more reliable
    await page.locator('#email').fill('admin@tradeguard.local');
    await page.locator('#password').fill('admin123');
    await page.locator('button[type="submit"]').click();

    // Should redirect to dashboard
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });
    await expect(page.locator('h1:has-text("Dashboard")')).toBeVisible({ timeout: 10000 });
  });

  test('can navigate to positions page', async ({ page }) => {
    // Login
    await page.goto('http://localhost:666/login');
    await page.locator('#email').fill('admin@tradeguard.local');
    await page.locator('#password').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Navigate to positions
    await page.locator('a:has-text("Positions")').click();
    await expect(page.locator('h1:has-text("Positions")')).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to settings page', async ({ page }) => {
    // Login
    await page.goto('http://localhost:666/login');
    await page.locator('#email').fill('admin@tradeguard.local');
    await page.locator('#password').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Navigate to settings
    await page.locator('a:has-text("Settings")').click();
    await expect(page).toHaveURL(/settings/, { timeout: 5000 });

    // Wait for loading to finish (page should not show "Loading...")
    await expect(page.locator('text=Loading...')).not.toBeVisible({ timeout: 15000 });

    // Should see settings sections
    await expect(page.locator('h2:has-text("Trading Mode")')).toBeVisible({ timeout: 5000 });
  });

  test('can navigate to P&L page', async ({ page }) => {
    // Login
    await page.goto('http://localhost:666/login');
    await page.locator('#email').fill('admin@tradeguard.local');
    await page.locator('#password').fill('admin123');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 10000 });

    // Navigate to P&L
    await page.locator('a:has-text("P&L")').click();
    await expect(page).toHaveURL(/pnl/, { timeout: 5000 });

    // Wait for page to load
    await expect(page.locator('h1:has-text("P&L")')).toBeVisible({ timeout: 10000 });
  });
});
