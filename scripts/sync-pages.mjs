import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { copyFileSync } from "node:fs";

const rootDir = resolve(import.meta.dirname, "..");
const docsAssetsDir = resolve(rootDir, "docs", "assets");
const rootAssetsDir = resolve(rootDir, "assets");
const rootNoJekyll = resolve(rootDir, ".nojekyll");
const docsNoJekyll = resolve(rootDir, "docs", ".nojekyll");
const docsPagesHtml = resolve(rootDir, "docs", "pages.html");
const docsIndexHtml = resolve(rootDir, "docs", "index.html");

if (existsSync(rootAssetsDir)) {
  rmSync(rootAssetsDir, { recursive: true, force: true });
}

if (existsSync(docsAssetsDir)) {
  mkdirSync(rootAssetsDir, { recursive: true });
  cpSync(docsAssetsDir, rootAssetsDir, { recursive: true });
}

if (existsSync(docsPagesHtml)) {
  copyFileSync(docsPagesHtml, docsIndexHtml);
}

writeFileSync(rootNoJekyll, "\n");
writeFileSync(docsNoJekyll, "\n");
