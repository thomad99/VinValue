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

app.use(cors({
  origin: ['http://localhost:3000', 'https://chat.openai.com', 'https://*.openai.com'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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

// Market value integration removed

async function fetchValuation({ vin, mileage, zip = DEFAULT_ZIP, email = DEFAULT_EMAIL, make, model, year }, progressCallback = null) {
  const browser = await launchChromium();
  const context = await browser.newContext();
  const page = await context.newPage();
  const steps = [];
  const selections = []; // Track all dropdown selections
  try {
    steps.push('Navigating to site');
    if (progressCallback) progressCallback('Navigating to website...');
    await page.goto('https://www.webuyanycarusa.com/?r=1', { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Determine which path to use: VIN or Make & Model
    if (vin && vin.trim()) {
      // Use VIN path
      steps.push(`Using VIN path: VIN=${vin}, Mileage=${mileage}, Zip=${zip}, Email=${email}`);
      if (progressCallback) progressCallback('Using VIN lookup method...');
      
      // Click VIN link
      const vinLink = page.locator('a', { hasText: 'VIN' });
      await vinLink.first().click();

      // Enter VIN (try several candidates)
      if (progressCallback) progressCallback('Entering VIN number...');
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
      if (progressCallback) progressCallback('Using Make & Model lookup...');
      
      // Make & Model tab should be active by default, but let's ensure it
      const makeModelTab = page.locator('a, button', { hasText: /Make.*Model/i });
      if (await makeModelTab.count()) {
        await makeModelTab.first().click();
      }

      // Select Year
      if (progressCallback) progressCallback('Selecting year...');
      const yearSelect = page.locator('select').first();
      if (await yearSelect.count()) {
        await yearSelect.waitFor({ state: 'visible', timeout: 10000 });
        await yearSelect.selectOption({ label: year });
        steps.push(`Selected year: ${year}`);
        selections.push(`Year: ${year}`);
      }

      // Wait for make dropdown to be enabled after year selection
      if (progressCallback) progressCallback('Selecting make...');
      const makeSelect = page.locator('select').nth(1);
      if (await makeSelect.count()) {
        await makeSelect.waitFor({ state: 'visible', timeout: 10000 });
        
        // Wait for make dropdown to be enabled (not disabled)
        await page.waitForFunction(() => {
          const selects = document.querySelectorAll('select');
          return selects[1] && !selects[1].disabled;
        }, { timeout: 15000 });
        
        try {
          await makeSelect.selectOption({ label: make });
          steps.push(`Selected make: ${make}`);
          selections.push(`Make: ${make}`);
        } catch (e) {
          // Try selecting by value or index if label fails
          try {
            await makeSelect.selectOption({ index: 1 }); // Select first non-placeholder option
            const selectedMake = await makeSelect.inputValue();
            steps.push(`Selected make (fallback): ${selectedMake}`);
            selections.push(`Make: ${selectedMake}`);
          } catch (e2) {
            throw new Error(`Could not select make: ${make}`);
          }
        }
      }

      // Wait for model dropdown to be enabled after make selection
      if (progressCallback) progressCallback('Selecting model...');
      const modelSelect = page.locator('select').nth(2);
      if (await modelSelect.count()) {
        // Wait for model dropdown to be enabled (not disabled)
        await page.waitForFunction(() => {
          const selects = document.querySelectorAll('select');
          return selects[2] && !selects[2].disabled;
        }, { timeout: 15000 });
        
        // Wait a bit more for options to load
        await page.waitForTimeout(2000);
        
        try {
          await modelSelect.selectOption({ label: model });
          steps.push(`Selected model: ${model}`);
          selections.push(`Model: ${model}`);
        } catch (e) {
          // Try selecting by value or index if label fails
          try {
            await modelSelect.selectOption({ index: 1 }); // Select first non-placeholder option
            const selectedModel = await modelSelect.inputValue();
            steps.push(`Selected model (fallback): ${selectedModel}`);
            selections.push(`Model: ${selectedModel}`);
          } catch (e2) {
            throw new Error(`Could not select model: ${model}`);
          }
        }
      }
    } else {
      throw new Error('Either VIN or Make/Model/Year must be provided');
    }

    steps.push('Clicking Value My Car');
    if (progressCallback) progressCallback('Clicking Get Valuation...');
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
      
      // Wait for page to fully load
      await page.waitForTimeout(3000);
      
      // Find all dropdowns/selects on the page
      const allSelects = await page.locator('select').all();
      console.log(`Found ${allSelects.length} select elements on Vehicle Details page`);
      let dropdownsFilled = 0;
      
      for (let i = 0; i < allSelects.length; i++) {
        const select = allSelects[i];
        try {
          const selectId = await select.getAttribute('id');
          const selectName = await select.getAttribute('name');
          console.log(`Processing select ${i}: id="${selectId}", name="${selectName}"`);
          
          const options = await select.locator('option').all();
          console.log(`Select ${i} has ${options.length} options`);
          
          if (options.length > 1) {
            // Select the first non-empty option (skip "Select..." placeholder)
            for (let j = 1; j < options.length; j++) {
              const value = await options[j].getAttribute('value');
              const text = await options[j].textContent();
              
              console.log(`Option ${j}: value="${value}", text="${text}"`);
              
              if (value && value.trim() && text && 
                  !text.toLowerCase().includes('select') &&
                  !text.toLowerCase().includes('choose') &&
                  !text.toLowerCase().includes('please')) {
                
                console.log(`Selecting option: ${text}`);
                await select.selectOption(value);
                dropdownsFilled++;
                const selectionText = text.trim();
                steps.push(`Selected dropdown option: ${selectionText}`);
                selections.push(selectionText); // Record the selection
                break;
              }
            }
          }
        } catch (e) {
          console.log(`Error processing select ${i}:`, e.message);
        }
      }
      
      // Also try to handle custom dropdown elements that might not be <select>
      try {
        const customDropdowns = await page.locator('div[role="combobox"], div[class*="dropdown"], div[class*="select"]').all();
        console.log(`Found ${customDropdowns.length} custom dropdown elements`);
        
        for (const dropdown of customDropdowns) {
          const isVisible = await dropdown.isVisible();
          if (isVisible) {
            console.log('Found visible custom dropdown, attempting to interact');
            await dropdown.click();
            await page.waitForTimeout(1000);
            
            // Look for options to select
            const optionSelectors = [
              '[role="option"]',
              '.option',
              'li',
              'div[class*="option"]'
            ];
            
            for (const optionSel of optionSelectors) {
              const options = await dropdown.locator(optionSel).all();
              if (options.length > 0) {
                const firstOption = options[0];
                const optionText = await firstOption.textContent();
                console.log(`Clicking custom dropdown option: ${optionText}`);
                await firstOption.click();
                selections.push(optionText);
                steps.push(`Selected custom dropdown option: ${optionText}`);
                break;
              }
            }
          }
        }
      } catch (e) {
        console.log('Error handling custom dropdowns:', e.message);
      }
      
      // Try to find and click any dropdown that might be a custom component
      try {
        const dropdownTriggers = await page.locator('[class*="dropdown"], [class*="select"], [data-testid*="dropdown"], [data-testid*="select"]').all();
        console.log(`Found ${dropdownTriggers.length} potential dropdown triggers`);
        
        for (const trigger of dropdownTriggers) {
          const isVisible = await trigger.isVisible();
          const text = await trigger.textContent();
          console.log(`Dropdown trigger: visible=${isVisible}, text="${text}"`);
          
          if (isVisible && text && (text.includes('Select') || text.includes('Body Type'))) {
            console.log('Clicking dropdown trigger:', text);
            await trigger.click();
            await page.waitForTimeout(1500);
            
            // Look for any clickable options that appeared
            const options = await page.locator('[role="option"], .option, li, div[class*="option"], span[class*="option"]').all();
            console.log(`Found ${options.length} options after clicking trigger`);
            
            if (options.length > 0) {
              const firstOption = options[0];
              const optionText = await firstOption.textContent();
              console.log(`Clicking first option: ${optionText}`);
              await firstOption.click();
              selections.push(optionText);
              steps.push(`Selected dropdown option: ${optionText}`);
              break;
            }
          }
        }
      } catch (e) {
        console.log('Error handling dropdown triggers:', e.message);
      }
      
      if (dropdownsFilled === 0) {
        steps.push('No standard dropdowns found to fill');
      }
      
      // Try a more aggressive approach to find the Body Type dropdown
      try {
        console.log('Trying aggressive Body Type dropdown detection...');
        
        // Look for any element that contains "Body Type" text
        const bodyTypeElements = await page.locator('text=/Body Type/i').all();
        console.log(`Found ${bodyTypeElements.length} elements containing "Body Type"`);
        
        for (const element of bodyTypeElements) {
          const isVisible = await element.isVisible();
          const tagName = await element.evaluate(el => el.tagName);
          const parent = element.locator('..');
          const parentTagName = await parent.evaluate(el => el.tagName);
          
          console.log(`Body Type element: visible=${isVisible}, tag=${tagName}, parent=${parentTagName}`);
          
          if (isVisible) {
            // Try clicking the element itself
            try {
              await element.click();
              console.log('Clicked Body Type element directly');
              await page.waitForTimeout(1000);
              
              // Look for options
              const options = await page.locator('[role="option"], .option, li, div[class*="option"], span[class*="option"]').all();
              if (options.length > 0) {
                const firstOption = options[0];
                const optionText = await firstOption.textContent();
                console.log(`Clicking first option: ${optionText}`);
                await firstOption.click();
                selections.push(optionText);
                steps.push(`Selected Body Type option: ${optionText}`);
                break;
              }
            } catch (e) {
              console.log('Could not click Body Type element directly:', e.message);
            }
            
            // Try clicking the parent element
            try {
              await parent.click();
              console.log('Clicked Body Type parent element');
              await page.waitForTimeout(1000);
              
              // Look for options
              const options = await page.locator('[role="option"], .option, li, div[class*="option"], span[class*="option"]').all();
              if (options.length > 0) {
                const firstOption = options[0];
                const optionText = await firstOption.textContent();
                console.log(`Clicking first option: ${optionText}`);
                await firstOption.click();
                selections.push(optionText);
                steps.push(`Selected Body Type option: ${optionText}`);
                break;
              }
            } catch (e) {
              console.log('Could not click Body Type parent:', e.message);
            }
          }
        }
        
        // Try clicking anywhere in the dropdown area to trigger it
        try {
          const dropdownArea = page.locator('text=/Select Body Type/i').first();
          if (await dropdownArea.count()) {
            console.log('Trying to click dropdown area to trigger it');
            await dropdownArea.click();
            await page.waitForTimeout(1500);
            
            // Look for any options that appeared
            const options = await page.locator('[role="option"], .option, li, div[class*="option"], span[class*="option"], [class*="item"]').all();
            console.log(`Found ${options.length} options after clicking dropdown area`);
            
            if (options.length > 0) {
              const firstOption = options[0];
              const optionText = await firstOption.textContent();
              console.log(`Clicking first option: ${optionText}`);
              await firstOption.click();
              selections.push(optionText);
              steps.push(`Selected Body Type option: ${optionText}`);
            }
          }
        } catch (e) {
          console.log('Error clicking dropdown area:', e.message);
        }
        
      } catch (e) {
        console.log('Error in aggressive Body Type detection:', e.message);
      }
      
      // Wait a moment for any dynamic updates
      await page.waitForTimeout(2000);
      
      // Click Continue to proceed to Vehicle Condition page
      const continueSelectors = [
        'button:has-text("Continue to Step 3")',
        'button:has-text("Continue")',
        'button[type="submit"]',
        'input[type="submit"]',
        'button[class*="continue"]',
        'button[class*="next"]'
      ];
      
      let continued = false;
      for (const sel of continueSelectors) {
        try {
          const btn = page.locator(sel).first();
          if (await btn.count()) {
            const isVisible = await btn.isVisible();
            const isEnabled = await btn.isEnabled();
            console.log(`Found continue button: ${sel}, visible: ${isVisible}, enabled: ${isEnabled}`);
            
            if (isVisible && isEnabled) {
              await btn.click();
              continued = true;
              steps.push('Clicked Continue to proceed to Vehicle Condition');
              break;
            }
          }
        } catch (e) {
          console.log(`Continue button ${sel} failed:`, e.message);
        }
      }
      
      if (continued) {
        // Wait for Vehicle Condition page to load
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      } else {
        console.log('Could not find or click continue button, trying fallback approach...');
        
        // Fallback: Try to find any clickable element that might proceed
        try {
          const allButtons = await page.locator('button, a, [role="button"], [onclick]').all();
          console.log(`Found ${allButtons.length} potential clickable elements`);
          
          for (const button of allButtons) {
            const isVisible = await button.isVisible();
            const text = await button.textContent();
            const isEnabled = await button.isEnabled();
            
            console.log(`Button: visible=${isVisible}, enabled=${isEnabled}, text="${text}"`);
            
            if (isVisible && isEnabled && text && (
              text.toLowerCase().includes('continue') || 
              text.toLowerCase().includes('next') || 
              text.toLowerCase().includes('proceed') ||
              text.toLowerCase().includes('step 3')
            )) {
              console.log(`Trying to click fallback button: ${text}`);
              await button.click();
              continued = true;
              steps.push(`Clicked fallback button: ${text}`);
              break;
            }
          }
          
          if (continued) {
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
          }
        } catch (e) {
          console.log('Fallback button clicking failed:', e.message);
        }
        
        if (!continued) {
          // Take debug screenshot
          try {
            const shotsDir = path.join(__dirname, 'public', 'shots');
            if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
            const name = `vehicle-details-debug-${Date.now()}.png`;
            const filePath = path.join(shotsDir, name);
            await page.screenshot({ path: filePath, fullPage: true });
            console.log(`Vehicle Details debug screenshot saved: ${name}`);
          } catch (_) {}
        }
      }
    }

    // Check if we're still on Vehicle Details page - if so, we need to complete it first
    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log(`Current URL: ${currentUrl}`);
    console.log(`Page title: ${pageTitle}`);
    
    if (currentUrl.includes('vehicledetails') || currentUrl.includes('vehicle-details') || pageTitle.includes('Vehicle Details')) {
      console.log('Still on Vehicle Details page - need to complete it first');
      throw new Error('Still on Vehicle Details page - Body Type selection failed. Please check the Vehicle Details page handling.');
    }
    
    // Enter mileage (Vehicle Condition page has placeholder "Enter Vehicle Mileage")
    steps.push('Filling Vehicle Condition: mileage');
    if (progressCallback) progressCallback('Entering mileage...');
    
    // Wait for Vehicle Condition page to fully load
    await page.waitForTimeout(3000);
    
    // Check current URL and page content
    const mileagePageUrl = page.url();
    console.log(`Current URL when looking for mileage: ${mileagePageUrl}`);
    
    // Get page title and content for debugging
    const mileagePageTitle = await page.title();
    console.log(`Page title: ${mileagePageTitle}`);
    
    // Verify we're on the Vehicle Condition page
    if (!mileagePageUrl.includes('vehiclecondition') && !mileagePageUrl.includes('vehicle-condition') && !mileagePageTitle.includes('Vehicle Condition')) {
      console.log('Not on Vehicle Condition page - cannot find mileage input');
      throw new Error(`Not on Vehicle Condition page. Current page: ${mileagePageTitle} (${mileagePageUrl})`);
    }
    
    console.log('Confirmed on Vehicle Condition page - looking for mileage input');
    let mileageFilled = false;
    
    // Try multiple approaches to find and fill mileage
    const mileageApproaches = [
      // Approach 1: By placeholder text (most common)
      async () => {
        console.log('Trying approach 1: placeholder text');
        const mil = page.getByPlaceholder(/Enter\s+Vehicle\s+Mileage/i);
        await mil.waitFor({ state: 'visible', timeout: 15000 });
        await mil.fill(String(mileage));
        console.log('Approach 1 success: filled by placeholder');
        return true;
      },
      // Approach 2: By placeholder variations
      async () => {
        console.log('Trying approach 2: placeholder variations');
        const mil = page.getByPlaceholder(/odometer/i);
        await mil.waitFor({ state: 'visible', timeout: 15000 });
        await mil.fill(String(mileage));
        console.log('Approach 2 success: filled by odometer placeholder');
        return true;
      },
      // Approach 3: By name attributes
      async () => {
        console.log('Trying approach 3: name attributes');
        const selectors = [
          'input[name*="mileage" i]',
          'input[name*="odometer" i]',
          'input[name*="miles" i]',
          'input[name*="vehicle" i]'
        ];
        for (const sel of selectors) {
          const el = page.locator(sel).first();
          if (await el.count()) {
            await el.fill(String(mileage));
            console.log(`Approach 3 success: filled by selector ${sel}`);
            return true;
          }
        }
        return false;
      },
      // Approach 4: By input type and context
      async () => {
        console.log('Trying approach 4: input type and context');
        const numberInputs = page.locator('input[type="number"]');
        const count = await numberInputs.count();
        console.log(`Found ${count} number inputs`);
        for (let i = 0; i < count; i++) {
          const input = numberInputs.nth(i);
          const placeholder = await input.getAttribute('placeholder');
          const name = await input.getAttribute('name');
          const id = await input.getAttribute('id');
          console.log(`Input ${i}: placeholder="${placeholder}", name="${name}", id="${id}"`);
          
          if (placeholder && (placeholder.toLowerCase().includes('mileage') || 
                             placeholder.toLowerCase().includes('odometer') ||
                             placeholder.toLowerCase().includes('miles'))) {
            await input.fill(String(mileage));
            console.log(`Approach 4 success: filled by number input with mileage placeholder`);
            return true;
          }
        }
        return false;
      },
      // Approach 5: By label text
      async () => {
        console.log('Trying approach 5: label text');
        const labels = page.locator('label');
        const labelCount = await labels.count();
        console.log(`Found ${labelCount} labels`);
        for (let i = 0; i < labelCount; i++) {
          const label = labels.nth(i);
          const labelText = await label.textContent();
          console.log(`Label ${i}: "${labelText}"`);
          if (labelText && (labelText.toLowerCase().includes('mileage') || 
                           labelText.toLowerCase().includes('odometer'))) {
            const forAttr = await label.getAttribute('for');
            const input = page.locator(`input[id="${forAttr}"]`);
            if (await input.count()) {
              await input.fill(String(mileage));
              console.log(`Approach 5 success: filled by label "${labelText}"`);
              return true;
            }
          }
        }
        return false;
      },
      // Approach 6: By any input that looks like mileage
      async () => {
        console.log('Trying approach 6: any input that looks like mileage');
        const allInputs = page.locator('input');
        const inputCount = await allInputs.count();
        console.log(`Found ${inputCount} total inputs`);
        
        for (let i = 0; i < inputCount; i++) {
          const input = allInputs.nth(i);
          const placeholder = await input.getAttribute('placeholder');
          const name = await input.getAttribute('name');
          const id = await input.getAttribute('id');
          const type = await input.getAttribute('type');
          
          console.log(`Input ${i}: type="${type}", placeholder="${placeholder}", name="${name}", id="${id}"`);
          
          if (type === 'text' || type === 'number') {
            if ((placeholder && (placeholder.toLowerCase().includes('mileage') || 
                                placeholder.toLowerCase().includes('odometer') ||
                                placeholder.toLowerCase().includes('miles'))) ||
                (name && (name.toLowerCase().includes('mileage') || 
                         name.toLowerCase().includes('odometer') ||
                         name.toLowerCase().includes('miles'))) ||
                (id && (id.toLowerCase().includes('mileage') || 
                       id.toLowerCase().includes('odometer') ||
                       id.toLowerCase().includes('miles')))) {
              await input.fill(String(mileage));
              console.log(`Approach 6 success: filled by input with mileage-related attributes`);
              return true;
            }
          }
        }
        return false;
      }
    ];
    
    for (let i = 0; i < mileageApproaches.length; i++) {
      try {
        console.log(`Trying mileage approach ${i + 1}...`);
        mileageFilled = await mileageApproaches[i]();
        if (mileageFilled) {
          console.log(`Successfully filled mileage using approach ${i + 1}`);
          break;
        }
      } catch (e) {
        console.log(`Mileage approach ${i + 1} failed:`, e.message);
        continue;
      }
    }
    
    if (!mileageFilled) {
      console.log('All mileage approaches failed, taking debug screenshot...');
      // Take a screenshot to help debug
      try {
        const shotsDir = path.join(__dirname, 'public', 'shots');
        if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
        const name = `mileage-debug-${Date.now()}.png`;
        const filePath = path.join(shotsDir, name);
        await page.screenshot({ path: filePath, fullPage: true });
        console.log(`Debug screenshot saved: ${name}`);
        
        // Also log all input elements on the page
        const allInputs = page.locator('input');
        const inputCount = await allInputs.count();
        console.log(`Page has ${inputCount} input elements total`);
        for (let i = 0; i < Math.min(inputCount, 10); i++) {
          const input = allInputs.nth(i);
          const placeholder = await input.getAttribute('placeholder');
          const name = await input.getAttribute('name');
          const id = await input.getAttribute('id');
          const type = await input.getAttribute('type');
          console.log(`Input ${i}: type="${type}", placeholder="${placeholder}", name="${name}", id="${id}"`);
        }
      } catch (_) {}
      
      throw new Error('Could not find mileage/odometer input field');
    }

    // Zip code (placeholder "Enter ZIP Code")
    steps.push('Filling Vehicle Condition: ZIP code');
    if (progressCallback) progressCallback('Entering ZIP code...');
    let zipFilled = false;
    
    const zipApproaches = [
      // Approach 1: By placeholder text
      async () => {
        console.log('Trying ZIP approach 1: placeholder text');
        const zipEl = page.getByPlaceholder(/Enter\s+ZIP\s+Code/i);
        await zipEl.waitFor({ state: 'visible', timeout: 15000 });
        await zipEl.fill(String(zip));
        console.log('ZIP approach 1 success: filled by placeholder');
        return true;
      },
      // Approach 2: By name attributes
      async () => {
        console.log('Trying ZIP approach 2: name attributes');
        const selectors = [
          'input[name*="zip" i]',
          'input[name*="postal" i]',
          'input[name*="zipcode" i]'
        ];
        for (const sel of selectors) {
          const el = page.locator(sel).first();
          if (await el.count()) {
            await el.fill(String(zip));
            console.log(`ZIP approach 2 success: filled by selector ${sel}`);
            return true;
          }
        }
        return false;
      },
      // Approach 3: By placeholder variations
      async () => {
        console.log('Trying ZIP approach 3: placeholder variations');
        const selectors = [
          'input[placeholder*="zip" i]',
          'input[placeholder*="postal" i]',
          'input[placeholder*="code" i]'
        ];
        for (const sel of selectors) {
          const el = page.locator(sel).first();
          if (await el.count()) {
            await el.fill(String(zip));
            console.log(`ZIP approach 3 success: filled by selector ${sel}`);
            return true;
          }
        }
        return false;
      },
      // Approach 4: By label text
      async () => {
        console.log('Trying ZIP approach 4: label text');
        const labels = page.locator('label');
        const labelCount = await labels.count();
        for (let i = 0; i < labelCount; i++) {
          const label = labels.nth(i);
          const labelText = await label.textContent();
          if (labelText && (labelText.toLowerCase().includes('zip') || 
                           labelText.toLowerCase().includes('postal'))) {
            const forAttr = await label.getAttribute('for');
            const input = page.locator(`input[id="${forAttr}"]`);
            if (await input.count()) {
              await input.fill(String(zip));
              console.log(`ZIP approach 4 success: filled by label "${labelText}"`);
              return true;
            }
          }
        }
        return false;
      }
    ];
    
    for (let i = 0; i < zipApproaches.length; i++) {
      try {
        console.log(`Trying ZIP approach ${i + 1}...`);
        zipFilled = await zipApproaches[i]();
        if (zipFilled) {
          console.log(`Successfully filled ZIP using approach ${i + 1}`);
          break;
        }
      } catch (e) {
        console.log(`ZIP approach ${i + 1} failed:`, e.message);
        continue;
      }
    }
    
    if (!zipFilled) {
      console.log('All ZIP approaches failed, taking debug screenshot...');
      try {
        const shotsDir = path.join(__dirname, 'public', 'shots');
        if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
        const name = `zip-debug-${Date.now()}.png`;
        const filePath = path.join(shotsDir, name);
        await page.screenshot({ path: filePath, fullPage: true });
        console.log(`ZIP debug screenshot saved: ${name}`);
      } catch (_) {}
    }

    // Email (placeholder "Enter Email Address")
    steps.push('Filling Vehicle Condition: email');
    if (progressCallback) progressCallback('Entering email address...');
    let emailFilled = false;
    
    const emailApproaches = [
      // Approach 1: By placeholder text
      async () => {
        console.log('Trying email approach 1: placeholder text');
        const emailEl = page.getByPlaceholder(/Enter\s+Email\s+Address/i);
        await emailEl.waitFor({ state: 'visible', timeout: 15000 });
        await emailEl.fill(email);
        console.log('Email approach 1 success: filled by placeholder');
        return true;
      },
      // Approach 2: By input type
      async () => {
        console.log('Trying email approach 2: input type');
        const emailEl = page.locator('input[type="email"]').first();
        if (await emailEl.count()) {
          await emailEl.fill(email);
          console.log('Email approach 2 success: filled by type="email"');
          return true;
        }
        return false;
      },
      // Approach 3: By name attributes
      async () => {
        console.log('Trying email approach 3: name attributes');
        const selectors = [
          'input[name*="email" i]',
          'input[name*="mail" i]',
          'input[name*="address" i]'
        ];
        for (const sel of selectors) {
          const el = page.locator(sel).first();
          if (await el.count()) {
            await el.fill(email);
            console.log(`Email approach 3 success: filled by selector ${sel}`);
            return true;
          }
        }
        return false;
      },
      // Approach 4: By placeholder variations
      async () => {
        console.log('Trying email approach 4: placeholder variations');
        const selectors = [
          'input[placeholder*="email" i]',
          'input[placeholder*="mail" i]',
          'input[placeholder*="address" i]'
        ];
        for (const sel of selectors) {
          const el = page.locator(sel).first();
          if (await el.count()) {
            await el.fill(email);
            console.log(`Email approach 4 success: filled by selector ${sel}`);
            return true;
          }
        }
        return false;
      },
      // Approach 5: By label text
      async () => {
        console.log('Trying email approach 5: label text');
        const labels = page.locator('label');
        const labelCount = await labels.count();
        for (let i = 0; i < labelCount; i++) {
          const label = labels.nth(i);
          const labelText = await label.textContent();
          if (labelText && (labelText.toLowerCase().includes('email') || 
                           labelText.toLowerCase().includes('mail'))) {
            const forAttr = await label.getAttribute('for');
            const input = page.locator(`input[id="${forAttr}"]`);
            if (await input.count()) {
              await input.fill(email);
              console.log(`Email approach 5 success: filled by label "${labelText}"`);
              return true;
            }
          }
        }
        return false;
      }
    ];
    
    for (let i = 0; i < emailApproaches.length; i++) {
      try {
        console.log(`Trying email approach ${i + 1}...`);
        emailFilled = await emailApproaches[i]();
        if (emailFilled) {
          console.log(`Successfully filled email using approach ${i + 1}`);
          break;
        }
      } catch (e) {
        console.log(`Email approach ${i + 1} failed:`, e.message);
        continue;
      }
    }
    
    if (!emailFilled) {
      console.log('All email approaches failed, taking debug screenshot...');
      try {
        const shotsDir = path.join(__dirname, 'public', 'shots');
        if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
        const name = `email-debug-${Date.now()}.png`;
        const filePath = path.join(shotsDir, name);
        await page.screenshot({ path: filePath, fullPage: true });
        console.log(`Email debug screenshot saved: ${name}`);
      } catch (_) {}
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
    if (progressCallback) progressCallback('Waiting for valuation result...');
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

    // Market value integration removed

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
    const errorText = await response.text();
    console.error('OpenAI API error:', response.status, response.statusText, errorText);
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log('OpenAI response:', data);
  
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('Invalid OpenAI response format');
  }
  
  const content = data.choices[0].message.content;
  console.log('OpenAI content:', content);
  
  try {
    // Remove markdown code blocks if present
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    return JSON.parse(cleanContent);
  } catch (e) {
    console.error('Failed to parse OpenAI response as JSON:', content);
    throw new Error('Failed to parse OpenAI response as JSON');
  }
}

app.post('/api/analyze-image', async (req, res) => {
  const { imageDataUrl } = req.body;
  if (!imageDataUrl) {
    return res.status(400).json({ error: 'Image data URL is required' });
  }
  
  try {
    console.log('Starting image analysis...');
    const result = await analyzeCarImage(imageDataUrl);
    console.log('Image analysis result:', result);
    res.json(result);
  } catch (err) {
    console.error('Image analysis error:', err);
    res.status(500).json({ 
      error: 'AI analysis failed', 
      message: err.message || 'Failed to analyze image',
      details: 'Check server logs for more information'
    });
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

// GPT-friendly endpoint with simplified response
app.post('/api/gpt-value', async (req, res) => {
  try {
    const { vin, mileage, make, model, year, zip, email } = req.body;
    
    // Validate input
    if (!vin && (!make || !model || !year)) {
      return res.status(400).json({ 
        error: 'Either VIN or (make, model, year) must be provided',
        usage: {
          vin_path: 'Provide vin and mileage',
          make_model_path: 'Provide make, model, year, and mileage'
        }
      });
    }
    
    if (!mileage) {
      return res.status(400).json({ 
        error: 'Mileage is required',
        usage: 'Provide mileage in miles (e.g., 50000)'
      });
    }
    
    // Use defaults if not provided
    const finalZip = zip || DEFAULT_ZIP;
    const finalEmail = email || DEFAULT_EMAIL;
    
    console.log(`GPT Request: ${vin ? 'VIN' : 'Make/Model'} path`);
    
    const result = await fetchValuation({
      vin,
      mileage: parseInt(mileage),
      zip: finalZip,
      email: finalEmail,
      make,
      model,
      year
    });
    
    // Return simplified response for GPT
    res.json({
      success: true,
      valuation: result.valuation,
      method: vin ? 'VIN Lookup' : 'Make & Model Lookup',
      selections: result.selections || [],
      message: `Car valued at $${result.valuation} using ${vin ? 'VIN' : 'Make & Model'} method`
    });
    
  } catch (error) {
    console.error('GPT API Error:', error);
    res.status(500).json({ 
      error: 'Valuation failed', 
      message: error.message,
      details: 'Check the web interface for detailed debugging information'
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


