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

async function fetchValuation({ vin, mileage, zip = DEFAULT_ZIP, email = DEFAULT_EMAIL, make, model, year }) {
  const browser = await launchChromium();
  const context = await browser.newContext();
  const page = await context.newPage();
  const steps = [];
  const selections = []; // Track all dropdown selections
  try {
    steps.push('Navigating to site');
    await page.goto('https://www.webuyanycarusa.com/?r=1', { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Determine which path to use: VIN or Make & Model
    if (vin && vin.trim()) {
      // Use VIN path
      steps.push(`Using VIN path: VIN=${vin}, Mileage=${mileage}, Zip=${zip}, Email=${email}`);
      
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
    } else if (make && model && year) {
      // Use Make & Model path
      steps.push(`Using Make & Model path: ${year} ${make} ${model}, Mileage=${mileage}, Zip=${zip}, Email=${email}`);
      
      // Make & Model tab should be active by default, but let's ensure it
      const makeModelTab = page.locator('a, button', { hasText: /Make.*Model/i });
      if (await makeModelTab.count()) {
        await makeModelTab.first().click();
      }

      // Select Year
      const yearSelect = page.locator('select').first();
      if (await yearSelect.count()) {
        await yearSelect.selectOption({ label: year });
        steps.push(`Selected year: ${year}`);
        selections.push(`Year: ${year}`);
      }

      // Select Make
      const makeSelect = page.locator('select').nth(1);
      if (await makeSelect.count()) {
        await makeSelect.selectOption({ label: make });
        steps.push(`Selected make: ${make}`);
        selections.push(`Make: ${make}`);
      }

      // Select Model
      const modelSelect = page.locator('select').nth(2);
      if (await modelSelect.count()) {
        await modelSelect.selectOption({ label: model });
        steps.push(`Selected model: ${model}`);
        selections.push(`Model: ${model}`);
      }
    } else {
      throw new Error('Either VIN or Make/Model/Year must be provided');
    }

    steps.push('Clicking Value My Car');
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

    // Wait for next page to render (URL may vary: vehicledetails or vehiclecondition)
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });

    // Check if we're on Vehicle Details page (step 2) and need to select dropdowns
    const currentUrl = page.url();
    if (currentUrl.includes('vehicledetails') || currentUrl.includes('vehicle-details')) {
      steps.push('On Vehicle Details page - filling all dropdowns');
      
      // Find all dropdowns/selects on the page
      const allSelects = await page.locator('select').all();
      let dropdownsFilled = 0;
      
      for (const select of allSelects) {
        const options = await select.locator('option').all();
        if (options.length > 1) {
          // Select the first non-empty option (skip "Select..." placeholder)
          for (let i = 1; i < options.length; i++) {
            const value = await options[i].getAttribute('value');
            const text = await options[i].textContent();
            if (value && value.trim() && text && !text.toLowerCase().includes('select')) {
              await select.selectOption(value);
              dropdownsFilled++;
              const selectionText = text.trim();
              steps.push(`Selected dropdown option: ${selectionText}`);
              selections.push(selectionText); // Record the selection
              break;
            }
          }
        }
      }
      
      if (dropdownsFilled === 0) {
        steps.push('No dropdowns found to fill');
      }
      
      // Click Continue to proceed to Vehicle Condition page
      const continueSelectors = [
        'button:has-text("Continue to Step 3")',
        'button:has-text("Continue")',
        'button[type="submit"]',
        'input[type="submit"]'
      ];
      
      let continued = false;
      for (const sel of continueSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.count()) {
          await btn.click();
          continued = true;
          steps.push('Clicked Continue to proceed to Vehicle Condition');
          break;
        }
      }
      
      if (continued) {
        // Wait for Vehicle Condition page to load
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      }
    }

    // Enter mileage (Vehicle Condition page has placeholder "Enter Vehicle Mileage")
    steps.push('Filling Vehicle Condition: mileage');
    let mileageFilled = false;
    try {
      const mil = page.getByPlaceholder(/Enter\s+Vehicle\s+Mileage/i);
      await mil.waitFor({ state: 'visible', timeout: 15000 });
      await mil.fill(String(mileage));
      mileageFilled = true;
    } catch (_) {}
    if (!mileageFilled) {
      const mileageSelectors = [
        'input[name*="mileage" i]',
        'input[name*="odometer" i]',
        'input[type="number"]',
        'input[placeholder*="odometer" i]',
        'input[placeholder*="mileage" i]',
        'input[aria-label*="mileage" i]',
        '#mileage'
      ];
      for (const sel of mileageSelectors) {
        const el = page.locator(sel).first();
        if (await el.count()) { await el.fill(String(mileage)); mileageFilled = true; break; }
      }
    }
    if (!mileageFilled) throw new Error('Could not find mileage/odometer input');

    // Zip code (placeholder "Enter ZIP Code")
    steps.push('Filling Vehicle Condition: ZIP code');
    let zipFilled = false;
    try {
      const zipEl = page.getByPlaceholder(/Enter\s+ZIP\s+Code/i);
      await zipEl.waitFor({ state: 'visible', timeout: 10000 });
      await zipEl.fill(String(zip));
      zipFilled = true;
    } catch (_) {}
    if (!zipFilled) {
      const zipSelectors = ['input[name*="zip" i]','input[name*="postal" i]','input[placeholder*="zip" i]'];
      for (const sel of zipSelectors) {
        const el = page.locator(sel).first();
        if (await el.count()) { await el.fill(String(zip)); zipFilled = true; break; }
      }
    }

    // Email (placeholder "Enter Email Address")
    steps.push('Filling Vehicle Condition: email');
    let emailFilled = false;
    try {
      const emailEl = page.getByPlaceholder(/Enter\s+Email\s+Address/i);
      await emailEl.waitFor({ state: 'visible', timeout: 10000 });
      await emailEl.fill(email);
      emailFilled = true;
    } catch (_) {}
    if (!emailFilled) {
      const emailSelectors = ['input[type="email"]','input[name*="email" i]','input[placeholder*="email" i]'];
      for (const sel of emailSelectors) {
        const el = page.locator(sel).first();
        if (await el.count()) { await el.fill(email); emailFilled = true; break; }
      }
    }

    // Click See your valuation
    // Take a screenshot of filled Vehicle Condition form
    let filledShot = null;
    try {
      const shotsDir = path.join(__dirname, 'public', 'shots');
      if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
      const name = `filled-${Date.now()}.png`;
      const filePath = path.join(shotsDir, name);
      await page.screenshot({ path: filePath, fullPage: true });
      filledShot = `/shots/${name}`;
      steps.push(`Captured screenshot before submit: ${filledShot}`);
    } catch (_) {}

    // Click See Your Valuation
    steps.push('Clicking See Your Valuation');
    const seeValBtn = page.getByRole('button', { name: /See\s+Your\s+Valuation/i });
    if (await seeValBtn.count()) {
      await seeValBtn.first().click();
    } else {
      const altBtn = page.locator('button:has-text("See Your Valuation"), a:has-text("See Your Valuation")');
      if (await altBtn.count()) await altBtn.first().click();
      else {
        const continueBtn = page.getByRole('button', { name: /Continue|Next|Get value/i });
        if (await continueBtn.count()) await continueBtn.first().click();
      }
    }

    // Wait for valuation result to appear
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Take screenshot of valuation page
    let resultShot = null;
    try {
      const shotsDir = path.join(__dirname, 'public', 'shots');
      if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
      const name = `valuation-${Date.now()}.png`;
      const filePath = path.join(shotsDir, name);
      await page.screenshot({ path: filePath, fullPage: true });
      resultShot = `/shots/${name}`;
      steps.push(`Captured valuation screenshot: ${resultShot}`);
    } catch (_) {}

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

    return { 
      valuation: valuationText, 
      steps, 
      selections, // Include dropdown selections
      screenshots: { filled: filledShot, result: resultShot } 
    };
  } catch (err) {
    // Capture error screenshot and rethrow structured error
    let errorShot = null;
    try {
      const shotsDir = path.join(__dirname, 'public', 'shots');
      if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
      const name = `error-${Date.now()}.png`;
      const filePath = path.join(shotsDir, name);
      await page.screenshot({ path: filePath, fullPage: true });
      errorShot = `/shots/${name}`;
      steps.push(`Captured error screenshot: ${errorShot}`);
    } catch (_) {}
    const errorPayload = { isKnown: true, message: err && err.message ? err.message : 'Automation failed', steps, screenshots: { error: errorShot } };
    throw errorPayload;
  } finally {
    await context.close();
    await browser.close();
  }
}

// OpenAI Vision API for image analysis
async function analyzeCarImage(imageDataUrl) {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Analyze this car image and extract: 1) VIN (17-character code if visible), 2) Year, 3) Make, 4) Model, 5) Mileage. Return as JSON: {"vin": "string or null", "year": "string or null", "make": "string or null", "model": "string or null", "mileage": "string or null"}. If no VIN but you find make/model/year, that\'s fine - we can use those instead.'
            },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ],
      max_tokens: 300
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.statusText}`);
  }

  const data = await response.json();
  const content = data.choices[0].message.content;
  
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error('Failed to parse OpenAI response');
  }
}

app.post('/api/analyze-image', async (req, res) => {
  const { imageDataUrl } = req.body;
  if (!imageDataUrl) {
    return res.status(400).json({ error: 'Image data URL is required' });
  }
  
  try {
    const result = await analyzeCarImage(imageDataUrl);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to analyze image' });
  }
});

app.post('/api/value', async (req, res) => {
  const { vin, mileage, zip, email, make, model, year } = req.body || {};
  if ((!vin && (!make || !model || !year)) || !mileage) {
    return res.status(400).json({ error: 'Either VIN or (make, model, year) and mileage are required' });
  }
  try {
    const result = await fetchValuation({ vin, mileage, zip, email, make, model, year });
    res.json(result);
  } catch (err) {
    if (err && err.isKnown) {
      res.status(500).json({ error: err.message || 'Failed to fetch valuation', steps: err.steps || [], screenshots: err.screenshots || {} });
    } else {
      res.status(500).json({ error: 'Failed to fetch valuation' });
    }
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Expose server defaults for client prefill
app.get('/api/defaults', (_req, res) => {
  res.json({ zip: DEFAULT_ZIP, email: DEFAULT_EMAIL });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


