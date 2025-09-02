const express = require('express');
const cors = require('cors');
const path = require('path');

// Ensure Playwright uses browsers shipped in node_modules on Render
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

// Import Playwright AFTER configuring env so it picks up the correct browser path
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;
const DEFAULT_EMAIL = process.env.WEBUYEMAIL || 'Thomad99@gmail.com';
const DEFAULT_ZIP = process.env.WEBUYZIPCODE || '34238';
const { execFile } = require('child_process');
const fs = require('fs');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

async function ensureChromiumInstalled() {
  return new Promise((resolve) => {
    // Attempt a quick existence check on the browsers cache folder inside node_modules
    try {
      const candidate = path.join(__dirname, 'node_modules', 'playwright-core', '.local-browsers');
      if (fs.existsSync(candidate)) return resolve();
    } catch (_) {}
    execFile('npx', ['playwright', 'install', 'chromium', '--force'], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' } }, () => resolve());
  });
}

async function launchChromium() {
  try {
    return await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });
  } catch (err) {
    // If launch fails due to missing browser, try installing once and retry
    await ensureChromiumInstalled();
    return await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process'
      ]
    });
  }
}

async function fetchValuation({ vin, mileage, zip = DEFAULT_ZIP, email = DEFAULT_EMAIL }) {
  const browser = await launchChromium();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto('https://www.webuyanycarusa.com/?r=1', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Click VIN link
    const vinLink = page.locator('a', { hasText: 'VIN' });
    await vinLink.first().click();

    // Enter VIN
    await page.waitForSelector('input[name="vin"]', { timeout: 30000 });
    await page.fill('input[name="vin"]', vin);

    // Click Value My Car
    const valueButton = page.locator('button, input[type="submit"]', { hasText: /Value My Car/i });
    await valueButton.first().click();

    // Enter mileage
    await page.waitForSelector('input[name*="mileage" i], input[name*="odometer" i]', { timeout: 30000 });
    await page.fill('input[name*="mileage" i], input[name*="odometer" i]', String(mileage));

    // Zip code
    await page.waitForSelector('input[name*="zip" i], input[name*="postal" i]', { timeout: 30000 });
    await page.fill('input[name*="zip" i], input[name*="postal" i]', String(zip));

    // Email
    await page.waitForSelector('input[type="email"], input[name*="email" i]', { timeout: 30000 });
    await page.fill('input[type="email"], input[name*="email" i]', email);

    // Click See your valuation
    const seeValBtn = page.locator('button, a', { hasText: /See your valuation/i });
    await seeValBtn.first().click();

    // Wait for valuation result to appear
    await page.waitForLoadState('networkidle', { timeout: 60000 });

    // Try to locate a price element
    const priceSelectors = [
      'text=/\$\s?\d{1,3}(,\d{3})*(\.\d{2})?/i',
      '[class*="price" i]',
      '[data-testid*="price" i]'
    ];

    let valuationText = null;
    for (const selector of priceSelectors) {
      const el = page.locator(selector).first();
      if (await el.count()) {
        const text = (await el.textContent()) || '';
        if (/\$\s?\d/.test(text)) {
          valuationText = text.trim();
          break;
        }
      }
    }

    // Fallback: get all text and find a $ amount
    if (!valuationText) {
      const bodyText = await page.textContent('body');
      const match = bodyText && bodyText.match(/\$\s?\d{1,3}(,\d{3})*(\.\d{2})?/);
      if (match) valuationText = match[0];
    }

    if (!valuationText) {
      throw new Error('Could not find valuation on the page. The site may have changed.');
    }

    return { valuation: valuationText };
  } finally {
    await context.close();
    await browser.close();
  }
}

app.post('/api/value', async (req, res) => {
  const { vin, mileage, zip, email } = req.body || {};
  if (!vin || !mileage) {
    return res.status(400).json({ error: 'vin and mileage are required' });
  }
  try {
    const result = await fetchValuation({ vin, mileage, zip, email });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch valuation' });
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


