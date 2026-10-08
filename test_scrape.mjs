import puppeteer from 'puppeteer-core';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36');
    
    console.log('Navigating to homepage...');
    await page.goto('https://www.mercadolibre.com.uy', { waitUntil: 'domcontentloaded', timeout: 15000 });

    console.log('Typing search query...');
    await page.waitForSelector('.nav-search-input', { timeout: 10000 });
    await page.type('.nav-search-input', 'termo stanley');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
      page.keyboard.press('Enter'),
    ]);

    console.log('Current URL:', page.url());
    const items = await page.evaluate(() => {
      // Find cards
      const cards = document.querySelectorAll('.poly-card, .ui-search-result, .ui-search-layout__item');
      return Array.from(cards).slice(0, 8).map(card => {
        const titleEl = card.querySelector('.poly-component__title, .ui-search-item__title');
        const linkEl = card.querySelector('a.poly-component__title, a.ui-search-link, a');
        const priceFraction = card.querySelector('.andes-money-amount__fraction');
        const currencySymbol = card.querySelector('.andes-money-amount__currency-symbol');
        const imgEl = card.querySelector('img');
        const sellerEl = card.querySelector('.poly-component__seller');

        return {
          title: titleEl?.textContent?.trim() || '',
          link: linkEl?.href || '',
          price: priceFraction?.textContent?.replace(/\./g, '').trim() || '',
          currency: currencySymbol?.textContent?.includes('U$S') || currencySymbol?.textContent?.includes('USD') ? 'USD' : 'UYU',
          image: imgEl?.src || '',
          seller: sellerEl?.textContent?.trim() || null,
        };
      }).filter(i => i.title && i.link);
    });

    console.log('Items found:', items.length);
    console.log(JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await browser.close();
  }
}

test();
