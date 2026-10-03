import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
});

try {
  const page = await browser.newPage();
  const source = path.resolve('docs/CourseMates-Initial-Task-List.html');

  await page.goto(pathToFileURL(source).href, { waitUntil: 'networkidle' });
  await page.pdf({
    path: 'docs/CourseMates-Initial-Task-List.pdf',
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: false,
  });
} finally {
  await browser.close();
}
