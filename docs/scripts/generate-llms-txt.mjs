// Generates llms.txt and llms-full.txt in docs/public/ at build time.
//
// - llms.txt is a compact index: title, description, absolute URL, one line
//   per page. This is the file an LLM-aware reader fetches to decide which
//   pages to pull into context.
// - llms-full.txt is the full docs inlined as markdown with section headers,
//   so a reader can paste the entire corpus into a chat and ask questions
//   without doing page-by-page fetches.
//
// Convention: https://llmstxt.org
//
// This script is intentionally dependency-free — it reads MDX files with
// Node's built-in fs and parses only the YAML frontmatter. Anything more
// involved should go through fumadocs-core.

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const CONTENT_DIR = join(DOCS_ROOT, 'content', 'docs');
const PUBLIC_DIR = join(DOCS_ROOT, 'public');

const SITE_URL = process.env.SITE_URL ?? 'https://openmdm.dev';

/**
 * Parse YAML frontmatter from an MDX file. Supports only the small subset
 * we actually write: string values in `key: value` form on single lines.
 */
function parseFrontmatter(source) {
  if (!source.startsWith('---\n')) {
    return { frontmatter: {}, body: source };
  }
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) {
    return { frontmatter: {}, body: source };
  }
  const raw = source.slice(4, end);
  const body = source.slice(end + 5);
  const frontmatter = {};
  for (const line of raw.split('\n')) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    value = value.trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/**
 * Recursively walk the docs content tree and yield MDX file paths.
 */
async function* walkMdx(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMdx(full);
    } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
      yield full;
    }
  }
}

/**
 * Convert an absolute MDX path to the public URL under /docs.
 *   content/docs/introduction.mdx              -> /docs/introduction
 *   content/docs/concepts/architecture.mdx     -> /docs/concepts/architecture
 *   content/docs/recipes/kiosk.mdx             -> /docs/recipes/kiosk
 */
function mdxPathToUrl(mdxPath) {
  const rel = relative(CONTENT_DIR, mdxPath).replace(new RegExp(`\\${sep}`, 'g'), '/');
  const withoutExt = rel.replace(/\.mdx$/, '');
  return `/docs/${withoutExt}`;
}

async function main() {
  if (!existsSync(CONTENT_DIR)) {
    console.error(`[llms-txt] content dir not found: ${CONTENT_DIR}`);
    process.exit(1);
  }
  await mkdir(PUBLIC_DIR, { recursive: true });

  const pages = [];
  for await (const mdxPath of walkMdx(CONTENT_DIR)) {
    const source = await readFile(mdxPath, 'utf8');
    const { frontmatter, body } = parseFrontmatter(source);
    pages.push({
      path: mdxPath,
      url: mdxPathToUrl(mdxPath),
      title: frontmatter.title ?? mdxPath,
      description: frontmatter.description ?? '',
      body: body.trim(),
    });
  }

  // Sort so the output is stable and readable: top-level pages first,
  // then each section (concepts, recipes, reference) grouped together.
  pages.sort((a, b) => a.url.localeCompare(b.url));

  // ----- llms.txt (index) -----
  const indexLines = [
    '# OpenMDM',
    '',
    '> Embeddable Mobile Device Management SDK for TypeScript. OpenMDM is a library you add to your existing backend — not a separate MDM server — to manage Android device fleets from the same process and database as the rest of your app.',
    '',
    '## Documentation',
    '',
  ];
  for (const page of pages) {
    const url = `${SITE_URL}${page.url}`;
    indexLines.push(`- [${page.title}](${url})${page.description ? `: ${page.description}` : ''}`);
  }
  indexLines.push('');
  indexLines.push('## Source');
  indexLines.push('');
  indexLines.push(`- [GitHub repository](https://github.com/azoila/openmdm)`);
  indexLines.push(`- [npm organization](https://www.npmjs.com/org/openmdm)`);
  indexLines.push('');

  await writeFile(join(PUBLIC_DIR, 'llms.txt'), indexLines.join('\n'), 'utf8');

  // ----- llms-full.txt (full content inlined) -----
  const fullLines = [
    '# OpenMDM — Full Documentation',
    '',
    '> This file is the complete OpenMDM documentation concatenated as markdown.',
    '> It is generated from the MDX sources at docs/content/docs. Paste it into',
    '> an LLM context window to ask questions without fetching pages individually.',
    '',
    `> Generated: ${new Date().toISOString()}`,
    '',
    '---',
    '',
  ];
  for (const page of pages) {
    fullLines.push(`## ${page.title}`);
    fullLines.push('');
    fullLines.push(`*URL: ${SITE_URL}${page.url}*`);
    if (page.description) {
      fullLines.push('');
      fullLines.push(`*${page.description}*`);
    }
    fullLines.push('');
    fullLines.push(page.body);
    fullLines.push('');
    fullLines.push('---');
    fullLines.push('');
  }
  await writeFile(join(PUBLIC_DIR, 'llms-full.txt'), fullLines.join('\n'), 'utf8');

  console.log(
    `[llms-txt] wrote ${pages.length} pages to llms.txt and llms-full.txt`,
  );
}

main().catch((err) => {
  console.error('[llms-txt] failed:', err);
  process.exit(1);
});
