import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { chromium } from 'playwright';

// Render the real Goods form and shared controls. Only API/query and app
// contexts are stubbed; this probe makes no business-data requests.
const require = createRequire(import.meta.url);
const root = path.resolve(new URL('..', import.meta.url).pathname);
const baseline = process.argv.includes('--baseline');
const modules = new Map();
const operation = { phase: 'idle', locked: false, submit() {}, retry() {}, release() {} };
const stubs = {
  '@tanstack/react-query': {
    useQuery({ queryKey }) { return { data: queryKey[1] === 'masters' ? { units: ['KG', 'PCS', 'METER', 'ROLL', 'BOX'], parties: [], products: [] } : undefined }; },
    useQueryClient() { return { invalidateQueries() {} }; },
  },
  'next/navigation': { useRouter() { return {}; } },
  'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children), __esModule: true },
  '@/lib/api': { getApiErrorStatus() { return 0; } },
  '@/services/gate': { gateApi: {} },
};
function load(file) {
  if (file.endsWith('/gate-shell.tsx')) return { useGate: () => ({ plantId: 'plant-1', plant: { name: 'Main Plant' } }) };
  if (file.endsWith('/use-gate-operation.ts')) return { useGateOperation: () => operation, gateFieldErrors: () => ({}), gateErrorMessage: () => '' };
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const repositoryPath = `frontend_v2/${path.relative(root, file)}`;
  const source = baseline && /(?:goods-entry\.tsx|gate-tokens\.css)$/.test(file)
    ? execFileSync('git', ['show', `e6d81bec02a8ab7e1c7de2f073330f5661d10622:${repositoryPath}`], { cwd: path.dirname(root), encoding: 'utf8' })
    : fs.readFileSync(file, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (stubs[name]) return stubs[name];
    if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
    const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(file), name);
    const resolved = ['', '.ts', '.tsx', '.js'].map(extension => base + extension).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${name} from ${file}`);
    return load(resolved);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${compiled}\n })`, { console, setTimeout, clearTimeout })(localRequire, module, module.exports);
  return module.exports;
}
const { GoodsEntry } = load(path.join(root, 'src/components/gate/goods-entry.tsx'));
const gateCssPath = path.join(root, 'src/components/gate/gate-tokens.css');
const gateCss = baseline
  ? execFileSync('git', ['show', 'e6d81bec02a8ab7e1c7de2f073330f5661d10622:frontend_v2/src/components/gate/gate-tokens.css'], { cwd: path.dirname(root), encoding: 'utf8' })
  : fs.readFileSync(gateCssPath, 'utf8');
const tailwindConfig = load(path.join(root, 'tailwind.config.ts')).default;
const globals = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8').replace(
  /url\("\/fonts\/([^"/]+)"\)/g,
  (_, filename) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(root, 'public/fonts', filename)).toString('base64')}")`,
);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
try {
  for (const direction of ['INWARD', 'OUTWARD']) {
    const markup = `<main class="mx-auto w-full max-w-[1180px] px-4 pb-28 pt-4 sm:px-6">${renderToStaticMarkup(React.createElement(GoodsEntry, { initialDirection: direction }))}</main>`;
    const css = (await postcss([tailwindcss({ ...tailwindConfig, content: [{ raw: markup, extension: 'html' }] })]).process(globals, { from: undefined })).css + gateCss;
    for (const width of [360, 390, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${markup}</body></html>`);
      await page.evaluate(() => document.fonts.ready);
      for (const input of await page.locator('input:not([type="date"]), textarea').all()) await input.fill('123456789012.3456');
      const geometry = await page.evaluate(() => ({
        viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        overflow: Array.from(document.querySelectorAll('form, fieldset, input, textarea, button')).map(element => {
          const box = element.getBoundingClientRect();
          return { tag: element.tagName, className: element.className, left: box.left, right: box.right, width: box.width };
        }).filter(box => box.left < -1 || box.right > innerWidth + 1),
      }));
      results.push({ direction, width, ...geometry });
      if (!baseline) {
        assert.equal(geometry.scrollWidth, width, `${direction} ${width}: document overflow`);
        assert.deepEqual(geometry.overflow, [], `${direction} ${width}: controls must remain within the viewport`);
        const controls = await page.locator('input, textarea, button').all();
        for (const control of controls) {
          await control.focus();
          assert.equal(await control.evaluate(element => document.activeElement === element), true);
        }
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ baseline, results }, null, 2));
