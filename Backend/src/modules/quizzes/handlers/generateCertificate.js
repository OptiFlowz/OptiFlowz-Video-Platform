import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { z } from 'zod';
import { readPool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATE_DIR = path.resolve(__dirname, '../certificate-template');

function prerequisites(object, userId) {
  const schema = z.object({
    quiz_id: z.string().uuid('Invalid quiz ID'),
    attempt_id: z.string().uuid('Invalid attempt ID'),
    userId: z.string().uuid('Invalid user ID'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalizeFullName(name) {
  return String(name || '')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\p{L}+/gu, (word) => word.charAt(0).toLocaleUpperCase('en-US') + word.slice(1));
}

function formatCompletionDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = date.getUTCDate();
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  const year = date.getUTCFullYear();

  return `${day}. ${month} ${year}`;
}

function assetDataUri(filename, mimeType) {
  return fs.readFile(path.join(TEMPLATE_DIR, filename)).then((buffer) => {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  });
}

function safeFilename(value) {
  return String(value || 'certificate')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'certificate';
}

function resolveBrowserExecutablePath() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(candidate)) || undefined;
}

async function getCertificateData({ quizId, attemptId, userId }) {
  const { rows } = await readPool.query(
    `
      SELECT
        qa.id AS attempt_id,
        qa.quiz_id,
        qa.user_id,
        qa.passed,
        qa.submitted_at,
        q.title AS quiz_title,
        q.has_certificate,
        u.full_name
      FROM quiz_attempts qa
      JOIN quizzes q
        ON q.id = qa.quiz_id
      JOIN users u
        ON u.id = qa.user_id
      WHERE qa.id = $1
        AND qa.user_id = $2
      LIMIT 1;
    `,
    [attemptId, userId]
  );

  const data = rows[0] || null;

  if (!data) {
    const error = new Error('Quiz attempt not found for the authenticated user.');
    error.status = 404;
    throw error;
  }

  if (data.quiz_id !== quizId) {
    const error = new Error('Quiz attempt does not belong to the provided quiz.');
    error.status = 400;
    throw error;
  }

  if (data.passed !== true) {
    const error = new Error('Quiz attempt has not passed.');
    error.status = 403;
    throw error;
  }

  if (data.has_certificate !== true) {
    const error = new Error('Certificate is not available for this quiz.');
    error.status = 403;
    throw error;
  }

  if (!data.submitted_at) {
    const error = new Error('Quiz attempt is missing a submission date.');
    error.status = 409;
    throw error;
  }

  return data;
}

async function buildCertificateHtml({ fullName, completionDate }) {
  const [template, css, backgroundUri, signatureUri] = await Promise.all([
    fs.readFile(path.join(TEMPLATE_DIR, 'index.html'), 'utf8'),
    fs.readFile(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8'),
    assetDataUri('Video Corner Certificate.webp', 'image/webp'),
    assetDataUri('signature.png', 'image/png'),
  ]);

  const inlinedCss = css.replace(
    /url\(["']?Video Corner Certificate\.webp["']?\)/g,
    `url("${backgroundUri}")`
  );

  return template
    .replace(/<link rel="stylesheet" href="styles\.css" \/>/, `<style>${inlinedCss}</style>`)
    .replace(/src="signature\.png"/g, `src="${signatureUri}"`)
    .replace('FULL NAME PLACEHOLDER', escapeHtml(fullName))
    .replace('ATTEMPMT submitted at dd.Month YYYY', escapeHtml(completionDate));
}

async function renderCertificatePdf(html) {
  let browser = null;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: resolveBrowserExecutablePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 1492,
      height: 1054,
      deviceScaleFactor: 1,
    });

    page.setDefaultNavigationTimeout(120000);
    page.setDefaultTimeout(120000);

    await page.setContent(html, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForSelector('.certificate', { timeout: 120000 });

    await page.waitForNetworkIdle({
      idleTime: 500,
      timeout: 120000,
    });

    await page.evaluate(async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {}
      }
    });

    const hasMontserrat = await page.evaluate(() => {
      return document.fonts?.check('16px Montserrat') ?? false;
    });

    if (!hasMontserrat) {
      console.warn('Montserrat font was not loaded before certificate PDF generation.');
    }

    await page.evaluate(async () => {
      const images = Array.from(document.images || []);
      const waitForImage = (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });

      await Promise.race([
        Promise.all(images.map(waitForImage)),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    });

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: '0mm',
        right: '0mm',
        bottom: '0mm',
        left: '0mm',
      },
    });

    await browser.close();
    browser = null;

    return pdfBuffer;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function generateCertificateInternal(object, userId = null) {
  const {
    quiz_id: quizId,
    attempt_id: attemptId,
    userId: validatedUserId,
  } = prerequisites(object, userId);

  const data = await getCertificateData({
    quizId,
    attemptId,
    userId: validatedUserId,
  });

  const fullName = capitalizeFullName(data.full_name);
  const completionDate = formatCompletionDate(data.submitted_at);

  if (!completionDate) {
    const error = new Error('Quiz attempt has an invalid submission date.');
    error.status = 409;
    throw error;
  }

  const html = await buildCertificateHtml({
    fullName,
    completionDate,
  });
  const pdfBuffer = await renderCertificatePdf(html);

  return {
    pdfBuffer,
    filename: `${safeFilename(data.quiz_title)}-certificate.pdf`,
  };
}
