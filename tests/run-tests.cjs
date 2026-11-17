#!/usr/bin/env node
/**
 * box-testing demo projektide automatiseeritud testimiskomplekt.
 *
 * Käivitamine:
 *   PLAYWRIGHT_BROWSERS_PATH=/home/sten/Documents/workspace/apollo-playwright-tests/.playwright-browsers \
 *   node tests/run-tests.cjs
 *
 * Tulemus kirjutatakse tests/results.json faili ning ebaõnnestunud
 * kontrollide ekraanipildid docs/screenshots/ kausta.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PLAYWRIGHT_MODULE =
  process.env.PLAYWRIGHT_MODULE ||
  '/home/sten/Documents/workspace/apollo-playwright-tests/node_modules/playwright';
const PLAYWRIGHT_BROWSERS =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  '/home/sten/Documents/workspace/apollo-playwright-tests/.playwright-browsers';

process.env.PLAYWRIGHT_BROWSERS_PATH = PLAYWRIGHT_BROWSERS;

const { chromium } = require(PLAYWRIGHT_MODULE);

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'file://' + ROOT;
const SHOTS_DIR = path.join(ROOT, 'docs', 'screenshots');
const RESULTS_FILE = path.join(__dirname, 'results.json');

const NAME_ERROR = 'Nimi peab olema vähemalt 2 tähemärki pikk.';
const EMAIL_ERROR = 'Palun sisestage korrektne e-posti aadress.';
const MESSAGE_ERROR = 'Sõnum peab olema vähemalt 10 tähemärki pikk.';
const SUCCESS = 'Vorm esitati edukalt!';

const pages = {
  black: '/black-box/index.html',
  gray: '/gray-box/index.html',
  white: '/white-box/white-box.html',
};

const cases = [];
function tc(id, area, title, expected, fn, opts = {}) {
  cases.push({ id, area, title, expected, fn, ...opts });
}

// ---------------------------------------------------------------------------
// Abifunktsioonid
// ---------------------------------------------------------------------------

function ensureDirs() {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

async function openPage(relativeUrl, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    locale: options.locale || 'et-EE',
  });
  const page = await context.newPage();
  const dialogs = [];
  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];

  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept().catch(() => {});
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));

  const started = Date.now();
  await page.goto(BASE_URL + relativeUrl, { waitUntil: 'load' });
  const loadMs = Date.now() - started;

  return { context, page, dialogs, consoleErrors, pageErrors, requests, loadMs };
}

async function close(ctx) {
  if (ctx && ctx.context) await ctx.context.close().catch(() => {});
}

async function screenshot(page, id) {
  const file = path.join(SHOTS_DIR, id + '.png');
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return 'docs/screenshots/' + id + '.png';
}

async function fillContact(page, { name = '', email = '', message = '' }) {
  await page.fill('#name', name);
  await page.fill('#email', email);
  await page.fill('#message', message);
}

async function submitContact(page) {
  await page.click('#contactForm button[type="submit"]');
  await page.waitForTimeout(120);
}

async function contactErrors(page) {
  return (await page.locator('.error-message').allTextContents()).map((value) =>
    value.trim()
  );
}

function sameList(actual, expected) {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

async function fillCalculator(page, a, b, operation = 'add') {
  await page.fill('#num1', String(a));
  await page.fill('#num2', String(b));
  await page.selectOption('#operation', operation);
}

async function submitCalculator(page) {
  await page.click('#calculatorForm button[type="submit"]');
  await page.waitForTimeout(120);
}

async function calculatorResult(page) {
  return (await page.locator('#result').textContent()).trim();
}

async function calculatorValidity(page) {
  return page.evaluate(() => {
    const form = document.getElementById('calculatorForm');
    const num1 = document.getElementById('num1');
    const num2 = document.getElementById('num2');
    return {
      formValid: form.checkValidity(),
      num1StepMismatch: num1.validity.stepMismatch,
      num2StepMismatch: num2.validity.stepMismatch,
      num1Message: num1.validationMessage,
      num2Message: num2.validationMessage,
    };
  });
}

async function dispatchCalculatorSubmit(page) {
  await page.evaluate(() => {
    document
      .getElementById('calculatorForm')
      .dispatchEvent(new Event('submit', { cancelable: true }));
  });
  await page.waitForTimeout(120);
}

async function fillWhite(page, a, b) {
  await page.fill('#arv1', String(a));
  await page.fill('#arv2', String(b));
}

async function submitWhite(page) {
  await page.click('input[type="submit"]');
  await page.waitForTimeout(120);
}

async function whiteResult(page) {
  return (await page.locator('#tulemus').textContent()).trim();
}

async function whiteValidity(page) {
  return page.evaluate(() => {
    const form = document.querySelector('form');
    const arv1 = document.getElementById('arv1');
    const arv2 = document.getElementById('arv2');
    return {
      formValid: form.checkValidity(),
      arv1StepMismatch: arv1.validity.stepMismatch,
      arv2StepMismatch: arv2.validity.stepMismatch,
      arv1Message: arv1.validationMessage,
      arv2Message: arv2.validationMessage,
    };
  });
}

// ---------------------------------------------------------------------------
// Black-box: kontaktvorm
// ---------------------------------------------------------------------------

tc(
  'BB-01',
  'black-box',
  'Valiidne kontaktvormi esitamine',
  'Kuvatakse eduteade „' + SUCCESS + '“ ja ühtegi veateadet ei kuvata.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari Maasikas',
        email: 'mari@example.com',
        message: 'Soovin teilt lisateavet toote kohta.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const pass = dialogs.includes(SUCCESS) && errors.every((value) => value === '');
      await screenshot(page, 'BB-01-valiidne-esitamine');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-02',
  'black-box',
  'Täiesti tühi kontaktvorm',
  'Kuvatakse kõik kolm veateadet: nimi, e-post ja sõnum; eduteadet ei kuvata.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await submitContact(page);
      const errors = await contactErrors(page);
      const expected = [NAME_ERROR, EMAIL_ERROR, MESSAGE_ERROR];
      const pass = sameList(errors, expected) && dialogs.length === 0;
      await screenshot(page, 'BB-02-tyhi-vorm');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-03',
  'black-box',
  'Nime alampiir: üks tähemärk',
  'Kuvatakse ainult nime veateade; e-post ja sõnum on korrektsed.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'A',
        email: 'a@example.com',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const expected = [NAME_ERROR, '', ''];
      const pass = sameList(errors, expected) && dialogs.length === 0;
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-04',
  'black-box',
  'Nime ja sõnumi täpsed alampiirid',
  'Nimi pikkusega 2 ja sõnum pikkusega 10 märki läbivad valideerimise; kuvatakse eduteade.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Li',
        email: 'li@example.com',
        message: '1234567890',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const pass = dialogs.includes(SUCCESS) && errors.every((value) => value === '');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-05',
  'black-box',
  'Sõnumi alampiir: üheksa tähemärki',
  'Kuvatakse ainult sõnumi veateade; nimi ja e-post on korrektsed.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'mari@example.com',
        message: '123456789',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const expected = ['', '', MESSAGE_ERROR];
      const pass = sameList(errors, expected) && dialogs.length === 0;
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-06',
  'black-box',
  'E-post ilma @-märgita',
  'Kuvatakse ainult e-posti veateade; nimi ja sõnum on korrektsed.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'mari.example.com',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const expected = ['', EMAIL_ERROR, ''];
      const pass = sameList(errors, expected) && dialogs.length === 0;
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-07',
  'black-box',
  'Ainult tühikutest koosnevad väljad trimmitakse',
  'Nime ja sõnumi tühikud eemaldatakse; mõlemad väljad loetakse tühjaks ja kuvatakse vead.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: '     ',
        email: 'mari@example.com',
        message: '          ',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const expected = [NAME_ERROR, '', MESSAGE_ERROR];
      const pass = sameList(errors, expected) && dialogs.length === 0;
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-08',
  'black-box',
  'Veateadete tühjendamine kordusestil',
  'Pärast esimest ebaõnnestunud ja seejärel korrektset esitamist on kõik veateated tühjad.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await submitContact(page);
      const firstErrors = await contactErrors(page);
      await fillContact(page, {
        name: 'Mari',
        email: 'mari@example.com',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const secondErrors = await contactErrors(page);
      const pass =
        firstErrors.filter(Boolean).length === 3 &&
        secondErrors.every((value) => value === '') &&
        dialogs.includes(SUCCESS);
      return {
        pass,
        actual:
          'esimesed vead=' +
          JSON.stringify(firstErrors) +
          '; teised vead=' +
          JSON.stringify(secondErrors) +
          '; dialoogid=' +
          JSON.stringify(dialogs),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'BB-09',
  'black-box',
  'Suurtähtedega e-posti aadress',
  'Aadress MARI@EXAMPLE.COM on korrektne ja vorm esitatakse edukalt.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'MARI@EXAMPLE.COM',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const pass = dialogs.includes(SUCCESS) && errors.every((value) => value === '');
      await screenshot(page, 'BB-09-suurtahd-email');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-01' }
);

tc(
  'BB-10',
  'black-box',
  'Neljatäheline tippdomeen (.info)',
  'Aadress mari@example.info on korrektne ja vorm esitatakse edukalt.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'mari@example.info',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const pass = dialogs.includes(SUCCESS) && errors.every((value) => value === '');
      await screenshot(page, 'BB-10-info-domeen');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-01' }
);

tc(
  'BB-11',
  'black-box',
  'Topelt-@ e-posti aadress',
  'Aadress a@@b.com on kehtetu ja selle kohta kuvatakse e-posti veateade.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'a@@b.com',
        message: 'See sõnum on piisavalt pikk.',
      });
      await submitContact(page);
      const errors = await contactErrors(page);
      const pass =
        errors[1] === EMAIL_ERROR && !dialogs.includes(SUCCESS);
      await screenshot(page, 'BB-11-topelt-at');
      return {
        pass,
        actual:
          'dialoogid=' +
          JSON.stringify(dialogs) +
          '; vead=' +
          JSON.stringify(errors),
      };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-02' }
);

// ---------------------------------------------------------------------------
// Gray-box: kalkulaator
// ---------------------------------------------------------------------------

const calculatorCases = [
  ['GB-01', 'Liitmine', 2, 3, 'add', 'Tulemus: 5'],
  ['GB-02', 'Lahutamine', 10, 4, 'subtract', 'Tulemus: 6'],
  ['GB-03', 'Korrutamine', 6, 7, 'multiply', 'Tulemus: 42'],
  ['GB-04', 'Jagamine', 9, 3, 'divide', 'Tulemus: 3'],
  ['GB-08', 'Negatiivne esimene arv', -5, 3, 'add', 'Tulemus: -2'],
];

for (const [id, title, a, b, operation, expectedResult] of calculatorCases) {
  tc(
    id,
    'gray-box',
    title + ': ' + a + ' ja ' + b,
    'Tulemuseks kuvatakse „' + expectedResult + '“.',
    async () => {
      const ctx = await openPage(pages.gray);
      const { page } = ctx;
      try {
        await fillCalculator(page, a, b, operation);
        await submitCalculator(page);
        const result = await calculatorResult(page);
        return {
          pass: result === expectedResult,
          actual: 'tulemus=' + JSON.stringify(result),
        };
      } finally {
        await close(ctx);
      }
    }
  );
}

tc(
  'GB-05',
  'gray-box',
  'Nulliga jagamine',
  'Kuvatakse teade „Jagamine nulliga ei ole lubatud!“ ja arvutustulemust ei kuvata.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, 5, 0, 'divide');
      await submitCalculator(page);
      const result = await calculatorResult(page);
      const pass = result === 'Jagamine nulliga ei ole lubatud!';
      await screenshot(page, 'GB-05-nulliga-jagamine');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'GB-06',
  'gray-box',
  'Mõlemad sisendid tühjad',
  'Kuvatakse teade „Sisesta kaks kehtivat numbrit!“ ja tulemust ei arvutata.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await page.click('#calculatorForm button[type="submit"]');
      await page.waitForTimeout(120);
      const result = await calculatorResult(page);
      const pass = result === 'Sisesta kaks kehtivat numbrit!';
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'GB-07',
  'gray-box',
  'Üks sisenditest on tühi',
  'Kuvatakse teade „Sisesta kaks kehtivat numbrit!“ ja tulemust ei arvutata.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await page.fill('#num1', '7');
      await page.click('#calculatorForm button[type="submit"]');
      await page.waitForTimeout(120);
      const result = await calculatorResult(page);
      const pass = result === 'Sisesta kaks kehtivat numbrit!';
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'GB-09',
  'gray-box',
  'Kümnendmurruga arvutamine (1,5 + 2,5)',
  'Kalkulaator võimaldab sisestada kümnendmurde ja kuvab tulemuse „Tulemus: 4“.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, 1.5, 2.5, 'add');
      const validity = await calculatorValidity(page);
      await submitCalculator(page);
      const result = await calculatorResult(page);
      const pass = result === 'Tulemus: 4';
      await screenshot(page, 'GB-09-kumnendmurd');
      return {
        pass,
        actual:
          'tulemus=' +
          JSON.stringify(result) +
          '; vorm kehtiv=' +
          validity.formValid +
          '; stepMismatch=' +
          validity.num1StepMismatch +
          '/' +
          validity.num2StepMismatch +
          '; brauseri teade=' +
          JSON.stringify(validity.num1Message || validity.num2Message),
      };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-03' }
);

tc(
  'GB-10',
  'gray-box',
  'Ujukomaarvu täpsus (0,1 + 0,2)',
  'Tulemuseks kuvatakse „Tulemus: 0.3“, mitte ujukomaarvu jääk.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, 0.1, 0.2, 'add');
      await dispatchCalculatorSubmit(page);
      const result = await calculatorResult(page);
      const pass = result === 'Tulemus: 0.3';
      await screenshot(page, 'GB-10-ujukomaarv');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-04' }
);

tc(
  'GB-11',
  'gray-box',
  'Numbrilise väärtuse ületäitumine',
  'Väga suure korrutise korral kuvatakse arusaadav veateade, mitte „Infinity“.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, '1e308', 10, 'multiply');
      await submitCalculator(page);
      const result = await calculatorResult(page);
      const pass = result !== 'Tulemus: Infinity' && result.startsWith('Tulemus: ');
      await screenshot(page, 'GB-11-infinity');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-05' }
);

tc(
  'GB-12',
  'gray-box',
  'Tundmatu tehte käsitlemine',
  'Tundmatu tehte korral kuvatakse veateade ega kuvata vaikimisi väärtust 0.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, 4, 2, 'add');
      await page.evaluate(() => {
        document.getElementById('operation').value = 'modulo';
        document
          .getElementById('calculatorForm')
          .dispatchEvent(new Event('submit', { cancelable: true }));
      });
      await page.waitForTimeout(120);
      const result = await calculatorResult(page);
      const pass =
        result !== 'Tulemus: 0' && result !== '' && !result.startsWith('Tulemus: ');
      await screenshot(page, 'GB-12-tundmatu-tehe');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-06' }
);

// ---------------------------------------------------------------------------
// White-box: summa arvutamine
// ---------------------------------------------------------------------------

const whiteCases = [
  ['WB-01', 'Tavaline summa', 30, 20, 'Summa on: 50'],
  ['WB-02', 'Summa üle 100', 60, 50, 'Summa on suurem kui 100!'],
  ['WB-03', 'Täpselt 100 (piirijuht)', 50, 50, 'Summa on: 100'],
  ['WB-04', 'Nullide summa', 0, 0, 'Summa on: 0'],
  ['WB-05', 'Negatiivne summa', -10, 5, 'Summa on: -5'],
  ['WB-09', '100 + 1 (piirist üle)', 100, 1, 'Summa on suurem kui 100!'],
];

for (const [id, title, a, b, expectedResult] of whiteCases) {
  tc(
    id,
    'white-box',
    title + ': ' + a + ' + ' + b,
    'Kuvatakse „' + expectedResult + '“.',
    async () => {
      const ctx = await openPage(pages.white);
      const { page } = ctx;
      try {
        await fillWhite(page, a, b);
        await submitWhite(page);
        const result = await whiteResult(page);
        await screenshot(page, id + '-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
        return {
          pass: result === expectedResult,
          actual: 'tulemus=' + JSON.stringify(result),
        };
      } finally {
        await close(ctx);
      }
    }
  );
}

tc(
  'WB-06',
  'white-box',
  'Kümnendmurdude summa kasutajaliideses (1,5 + 2,5)',
  'Vorm võimaldab sisestada kümnendarve ja kuvab tulemuse „Summa on: 4“.',
  async () => {
    const ctx = await openPage(pages.white);
    const { page } = ctx;
    try {
      await fillWhite(page, 1.5, 2.5);
      const validity = await whiteValidity(page);
      await submitWhite(page);
      const result = await whiteResult(page);
      const pass = result === 'Summa on: 4';
      await screenshot(page, 'WB-06-kumnendmurd');
      return {
        pass,
        actual:
          'tulemus=' +
          JSON.stringify(result) +
          '; vorm kehtiv=' +
          validity.formValid +
          '; stepMismatch=' +
          validity.arv1StepMismatch +
          '/' +
          validity.arv2StepMismatch +
          '; brauseri teade=' +
          JSON.stringify(validity.arv1Message || validity.arv2Message),
      };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-03' }
);

tc(
  'WB-07',
  'white-box',
  'Kümnendmurdude summa otsekutsega (1,5 + 2,5)',
  'Funktsioon arvutaSumma() liidab kümnendarvud täpselt: tulemus 4.',
  async () => {
    const ctx = await openPage(pages.white);
    const { page } = ctx;
    try {
      const result = await page.evaluate(() => {
        document.getElementById('arv1').value = '1.5';
        document.getElementById('arv2').value = '2.5';
        arvutaSumma();
        return document.getElementById('tulemus').textContent.trim();
      });
      const pass = result === 'Summa on: 4';
      await screenshot(page, 'WB-07-parseint');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-07' }
);

tc(
  'WB-08',
  'white-box',
  'Tühjade sisendite otsekutse',
  'Funktsioon käsitleb tühje sisendeid veateatega ega kuva teksti „NaN“.',
  async () => {
    const ctx = await openPage(pages.white);
    const { page } = ctx;
    try {
      const result = await page.evaluate(() => {
        document.getElementById('arv1').value = '';
        document.getElementById('arv2').value = '';
        arvutaSumma();
        return document.getElementById('tulemus').textContent.trim();
      });
      const pass = result !== 'Summa on: NaN' && result.length > 0;
      await screenshot(page, 'WB-08-nan');
      return { pass, actual: 'tulemus=' + JSON.stringify(result) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-08' }
);

// ---------------------------------------------------------------------------
// Kasutajaliidese ja ligipääsetavuse kontrollid
// ---------------------------------------------------------------------------

tc(
  'UI-01',
  'ui',
  'Kontaktvormi siltide seotus väljadega',
  'Kõigil kolmel väljal on temaga seotud label-element (for/id vastavus).',
  async () => {
    const ctx = await openPage(pages.black);
    const { page } = ctx;
    try {
      const labels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('label')).map((label) => ({
          for: label.getAttribute('for'),
          text: label.textContent.trim(),
          targetExists: Boolean(
            label.getAttribute('for') &&
              document.getElementById(label.getAttribute('for'))
          ),
        }))
      );
      const pass =
        labels.length === 3 && labels.every((label) => label.targetExists);
      return { pass, actual: JSON.stringify(labels) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'UI-02',
  'ui',
  'Kalkulaatori väljade sildid',
  'Kalkulaatori arvväljadel ja tehte valikul on kirjeldavad label-elementid.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      const labels = await page.evaluate(() => ({
        labelCount: document.querySelectorAll('label').length,
        inputs: Array.from(document.querySelectorAll('input, select')).map(
          (element) => ({
            id: element.id,
            placeholder: element.getAttribute('placeholder'),
            ariaLabel: element.getAttribute('aria-label'),
            ariaLabelledBy: element.getAttribute('aria-labelledby'),
          })
        ),
      }));
      const pass = labels.labelCount >= 3;
      await screenshot(page, 'UI-02-kalkulaator-sildid');
      return { pass, actual: JSON.stringify(labels) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-09' }
);

tc(
  'UI-03',
  'ui',
  'Veateadete teadaandmine ekraanilugejale',
  'Veateated on seotud väljadega aria-describedby kaudu ja neil on aria-live/role=alert.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page } = ctx;
    try {
      await submitContact(page);
      const info = await page.evaluate(() => {
        const ids = ['name', 'email', 'message'];
        const errors = ['nameError', 'emailError', 'messageError'];
        return {
          inputs: ids.map((id) => {
            const input = document.getElementById(id);
            return {
              id,
              ariaDescribedBy: input.getAttribute('aria-describedby'),
              ariaInvalid: input.getAttribute('aria-invalid'),
            };
          }),
          errors: errors.map((id) => {
            const element = document.getElementById(id);
            return {
              id,
              role: element.getAttribute('role'),
              ariaLive: element.getAttribute('aria-live'),
            };
          }),
        };
      });
      const pass =
        info.errors.every(
          (error) =>
            error.role === 'alert' ||
            error.ariaLive === 'polite' ||
            error.ariaLive === 'assertive'
        ) &&
        info.inputs.every((input) => Boolean(input.ariaDescribedBy));
      await screenshot(page, 'UI-03-veateadete-aria');
      return { pass, actual: JSON.stringify(info) };
    } finally {
      await close(ctx);
    }
  },
  { defect: 'D-10' }
);

tc(
  'UI-04',
  'ui',
  'Vormi esitamine klaviatuuriga',
  'Korrektselt täidetud kontaktvormi saab esitada Enter-klahviga ilma hiirekursorita.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: 'Mari',
        email: 'mari@example.com',
        message: 'See sõnum on piisavalt pikk.',
      });
      await page.focus('#name');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      const pass = dialogs.includes(SUCCESS);
      return { pass, actual: 'dialoogid=' + JSON.stringify(dialogs) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'UI-05',
  'ui',
  'Responsiivsus 375 px vaateaknal',
  'Kõik kolm lehte mahuvad 375 px laiusele ekraanile ilma horisontaalse kerimiseta.',
  async () => {
    const results = {};
    for (const [name, url] of Object.entries(pages)) {
      const ctx = await openPage(url, { viewport: { width: 375, height: 812 } });
      const { page } = ctx;
      try {
        results[name] = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }));
        if (name === 'black') {
          await screenshot(page, 'UI-05-375px-kontaktvorm');
        }
      } finally {
        await close(ctx);
      }
    }
    const pass = Object.values(results).every((value) => !value.overflow);
    return { pass, actual: JSON.stringify(results) };
  },
  { defect: 'D-11' }
);

// ---------------------------------------------------------------------------
// Integratsioonikontrollid (DOM + skript + CSS)
// ---------------------------------------------------------------------------

tc(
  'IT-01',
  'integration',
  'Kontaktvormi veateadete DOM-i, skripti ja CSS-i koostoime',
  'Tühja vormi esitamisel tekib nähtav punane 14 px veateade (kõigi kolme vea olemasolu kontrollib BB-02).',
  async () => {
    const ctx = await openPage(pages.black);
    const { page } = ctx;
    try {
      await submitContact(page);
      const info = await page.evaluate(() => {
        const element = document.getElementById('nameError');
        const style = getComputedStyle(element);
        return {
          text: element.textContent.trim(),
          color: style.color,
          fontSize: style.fontSize,
          display: style.display,
          visible: element.getBoundingClientRect().height > 0,
        };
      });
      const pass =
        info.text === NAME_ERROR &&
        info.color === 'rgb(255, 0, 0)' &&
        info.fontSize === '14px' &&
        info.visible;
      return { pass, actual: JSON.stringify(info) };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'IT-02',
  'integration',
  'Kalkulaatori tulemuse DOM-i, skripti ja CSS-i koostoime',
  'Pärast arvutust 2 + 3 on tulemuse element nähtav, tekstiga „Tulemus: 5“ ja 18 px suurune.',
  async () => {
    const ctx = await openPage(pages.gray);
    const { page } = ctx;
    try {
      await fillCalculator(page, 2, 3, 'add');
      await submitCalculator(page);
      const info = await page.evaluate(() => {
        const element = document.getElementById('result');
        const style = getComputedStyle(element);
        return {
          text: element.textContent.trim(),
          fontSize: style.fontSize,
          visible: element.getBoundingClientRect().height > 0,
        };
      });
      const pass =
        info.text === 'Tulemus: 5' &&
        info.fontSize === '18px' &&
        info.visible;
      return { pass, actual: JSON.stringify(info) };
    } finally {
      await close(ctx);
    }
  }
);

// ---------------------------------------------------------------------------
// Mittefunktsionaalsed kontrollid
// ---------------------------------------------------------------------------

tc(
  'NF-01',
  'nonfunctional',
  'Lehtede laadimisaeg lokaalselt',
  'Iga leht laadub lokaalsest failisüsteemist alla 500 ms.',
  async () => {
    const timings = {};
    for (const [name, url] of Object.entries(pages)) {
      const ctx = await openPage(url);
      try {
        timings[name] = ctx.loadMs;
      } finally {
        await close(ctx);
      }
    }
    const pass = Object.values(timings).every((value) => value < 500);
    return { pass, actual: JSON.stringify(timings) };
  }
);

tc(
  'NF-02',
  'nonfunctional',
  'Välised võrgupäringud ja andmete salvestamine',
  'Lehed ei tee väliseid võrgupäringuid ega salvesta andmeid localStorage\'i, sessionStorage\'i ega küpsistesse.',
  async () => {
    const results = {};
    for (const [name, url] of Object.entries(pages)) {
      const ctx = await openPage(url);
      const { page, requests } = ctx;
      try {
        const storage = await page.evaluate(() => ({
          localStorage: window.localStorage.length,
          sessionStorage: window.sessionStorage.length,
          cookie: document.cookie,
        }));
        results[name] = {
          externalRequests: requests.filter(
            (request) => !request.startsWith('file://')
          ),
          storage,
        };
      } finally {
        await close(ctx);
      }
    }
    const pass = Object.values(results).every(
      (result) =>
        result.externalRequests.length === 0 &&
        result.storage.localStorage === 0 &&
        result.storage.sessionStorage === 0 &&
        result.storage.cookie === ''
    );
    return { pass, actual: JSON.stringify(results) };
  }
);

tc(
  'NF-03',
  'nonfunctional',
  'Sisendi turvaline kuvamine (XSS-katse)',
  'HTML- ja skriptisisu väljadel ei käivitata; veateated kuvatakse tekstina.',
  async () => {
    const ctx = await openPage(pages.black);
    const { page, dialogs } = ctx;
    try {
      await fillContact(page, {
        name: '<img src=x onerror="window.__xss=1">',
        email: 'mari@example.com',
        message: '<script>window.__xss=1<\/script>',
      });
      await submitContact(page);
      const result = await page.evaluate(() => ({
        xss: window.__xss || null,
        imgCount: document.querySelectorAll('img').length,
        scriptCount: document.querySelectorAll('script').length,
        nameError: document.getElementById('nameError').textContent.trim(),
      }));
      const pass =
        result.xss === null &&
        result.imgCount === 0 &&
        result.nameError === '';
      return {
        pass,
        actual:
          JSON.stringify(result) + '; dialoogid=' + JSON.stringify(dialogs),
      };
    } finally {
      await close(ctx);
    }
  }
);

tc(
  'NF-04',
  'nonfunctional',
  'Konsooli ja JavaScripti vead',
  'Ühelgi lehel ei teki konsolivigu ega käsitlemata JavaScripti erindeid.',
  async () => {
    const results = {};
    for (const [name, url] of Object.entries(pages)) {
      const ctx = await openPage(url);
      const { page } = ctx;
      try {
        await page.waitForTimeout(100);
        results[name] = {
          consoleErrors: ctx.consoleErrors,
          pageErrors: ctx.pageErrors,
        };
      } finally {
        await close(ctx);
      }
    }
    const pass = Object.values(results).every(
      (result) =>
        result.consoleErrors.length === 0 && result.pageErrors.length === 0
    );
    return { pass, actual: JSON.stringify(results) };
  }
);

// ---------------------------------------------------------------------------
// Käivitaja
// ---------------------------------------------------------------------------

let browser;

async function main() {
  ensureDirs();
  browser = await chromium.launch({ headless: true });
  const version = browser.version();

  const startedAt = new Date();
  const executed = [];

  for (const testCase of cases) {
    const started = Date.now();
    let record;
    try {
      const result = await testCase.fn();
      record = {
        id: testCase.id,
        area: testCase.area,
        title: testCase.title,
        expected: testCase.expected,
        actual: result.actual,
        status: result.pass ? 'PASS' : 'FAIL',
        defect: testCase.defect || null,
        durationMs: Date.now() - started,
        screenshot: null,
      };
    } catch (error) {
      record = {
        id: testCase.id,
        area: testCase.area,
        title: testCase.title,
        expected: testCase.expected,
        actual: 'TESTI VIGA: ' + error.message,
        status: 'ERROR',
        defect: testCase.defect || null,
        durationMs: Date.now() - started,
        screenshot: null,
      };
    }
    executed.push(record);
    const icon =
      record.status === 'PASS' ? 'PASS' : record.status === 'FAIL' ? 'FAIL' : 'ERROR';
    console.log(
      `${icon.padEnd(5)} ${record.id.padEnd(6)} ${record.title} (${record.durationMs} ms)`
    );
  }

  const screenshotFiles = fs.existsSync(SHOTS_DIR)
    ? fs.readdirSync(SHOTS_DIR).filter((file) => file.endsWith('.png'))
    : [];
  for (const item of executed) {
    const match = screenshotFiles.find((file) => file.startsWith(item.id + '-'));
    if (match) item.screenshot = 'docs/screenshots/' + match;
  }

  const summary = {
    total: executed.length,
    pass: executed.filter((item) => item.status === 'PASS').length,
    fail: executed.filter((item) => item.status === 'FAIL').length,
    error: executed.filter((item) => item.status === 'ERROR').length,
    byArea: {},
    defects: [...new Set(executed.map((item) => item.defect).filter(Boolean))].sort(),
  };
  for (const item of executed) {
    if (!summary.byArea[item.area]) {
      summary.byArea[item.area] = { total: 0, pass: 0, fail: 0, error: 0 };
    }
    summary.byArea[item.area].total += 1;
    summary.byArea[item.area][item.status.toLowerCase()] += 1;
  }

  const report = {
    meta: {
      project: 'box-testing-master',
      testedAt: new Intl.DateTimeFormat('et-EE', {
        dateStyle: 'full',
        timeStyle: 'medium',
        timeZone: 'Europe/Tallinn',
      }).format(startedAt),
      startedAt: startedAt.toISOString(),
      durationMs: executed.reduce((sum, item) => sum + item.durationMs, 0),
      browser: 'Chromium ' + version,
      playwright: require(path.join(PLAYWRIGHT_MODULE, 'package.json')).version,
      node: process.version,
      os: os.type() + ' ' + os.release() + ' ' + os.arch(),
      baseUrl: BASE_URL,
    },
    summary,
    cases: executed,
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(report, null, 2) + '\n');
  console.log('\nKokkuvõte:', JSON.stringify(summary));
  console.log('Tulemused:', RESULTS_FILE);
  await browser.close();
}

main().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
});
