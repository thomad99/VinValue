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
    await page.goto('https://www.webuyanycarusa.com/?r=1', { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Click VIN link
    const vinLink = page.locator('a', { hasText: 'VIN' });
    await vinLink.first().click();

    // Enter VIN (try several candidates)
    const vinSelectors = [
      'input[name="vin"]',
      'input#vin',
      'input[placeholder*="VIN" i]'
    ];
    let vinFilled = false;
    for (const sel of vinSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.fill(vin);
        vinFilled = true;
        break;
      }
    }
    if (!vinFilled) throw new Error('Could not find VIN input');

    // Click Value My Car (try several CTA variants)
    const ctaCandidates = [
      page.getByRole('button', { name: /Value My Car/i }),
      page.locator('button:has-text("Value My Car")'),
      page.locator('input[type="submit"][value*="Value" i]'),
      page.locator('button:has-text("Continue")')
    ];
    let clickedCTA = false;
    for (const cta of ctaCandidates) {
      if (await cta.count()) {
        await cta.first().click();
        clickedCTA = true;
        break;
      }
    }
    if (!clickedCTA) throw new Error('Could not find Value My Car button');

    // Wait for vehicle details page
    await page.waitForLoadState('domcontentloaded', { timeout: 90000 });
    await page.waitForURL(/valuation\/vehicledetails/i, { timeout: 90000 });

    // Enter mileage (robust selector set with retries)
    const mileageSelectors = [
      'input[name*="mileage" i]',
      'input[name*="odometer" i]',
      'input[type="number"]',
      'input[placeholder*="odometer" i]',
      'input[placeholder*="mileage" i]'
    ];
    let mileageFilled = false;
    for (const sel of mileageSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.scrollIntoViewIfNeeded();
        await el.fill(String(mileage));
        mileageFilled = true;
        break;
      }
    }
    if (!mileageFilled) {
      // small wait and retry once
      await page.waitForTimeout(2000);
      for (const sel of mileageSelectors) {
        const el = page.locator(sel).first();
        if (await el.count()) {
          await el.scrollIntoViewIfNeeded();
          await el.fill(String(mileage));
          mileageFilled = true;
          break;
        }
      }
    }
    if (!mileageFilled) throw new Error('Could not find mileage/odometer input');

    // Zip code
    const zipSelectors = [
      'input[name*="zip" i]',
      'input[name*="postal" i]',
      'input[placeholder*="zip" i]'
    ];
    for (const sel of zipSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.fill(String(zip));
        break;
      }
    }

    // Email
    const emailSelectors = [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[placeholder*="email" i]'
    ];
    for (const sel of emailSelectors) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.fill(email);
        break;
      }
    }

    // Click See your valuation
    const seeValBtn = page.locator('button:has-text("See your valuation"), a:has-text("See your valuation")');
    if (await seeValBtn.count()) {
      await seeValBtn.first().click();
    } else {
      const continueBtn = page.getByRole('button', { name: /Continue|Next|Get value/i });
      if (await continueBtn.count()) await continueBtn.first().click();
    }

    // Wait for valuation result to appear
    await page.waitForLoadState('networkidle', { timeout: 90000 });

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


