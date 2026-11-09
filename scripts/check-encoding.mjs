#!/usr/bin/env node
/**
 * Проверка кодировок в репозитории.
 *
 * Зачем: на Windows кириллица ломалась трижды и каждый раз по-новому —
 * .ps1 без BOM, тело запроса в ANSI, аргументы psql в OEM. Правила в
 * документации не помогают: их забывают. Этот скрипт — барьер, который
 * срабатывает до коммита.
 *
 * Что проверяется:
 *   1. Все .ps1 начинаются с UTF-8 BOM (иначе PowerShell 5.1 читает ANSI);
 *   2. Все текстовые файлы — валидный UTF-8;
 *   3. В текстах нет символа U+FFFD (замена при неудачном декодировании).
 *
 * Запуск:  node scripts/check-encoding.mjs
 * Код 1 — если найдены проблемы (годится для pre-commit и CI).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.local', 'coverage']);

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json',
  '.md', '.css', '.html', '.yml', '.yaml', '.sql', '.ps1', '.svg', '.txt',
]);

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** Рекурсивный обход без сторонних зависимостей. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

const problems = [];
const ps1WithoutBom = [];
let checked = 0;

for (const file of walk(ROOT)) {
  const ext = extname(file).toLowerCase();
  if (!TEXT_EXT.has(ext)) continue;

  const rel = relative(ROOT, file);
  const buffer = readFileSync(file);
  checked += 1;

  // 1. PowerShell: BOM обязателен
  if (ext === '.ps1') {
    const hasBom = buffer.subarray(0, 3).equals(BOM);
    if (!hasBom) ps1WithoutBom.push(rel);
  }

  // 2. Валидный UTF-8: Buffer.toString('utf8') не бросает, поэтому проверяем
  //    через TextDecoder с fatal — он падает на некорректных байтах.
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    problems.push(`${rel}: файл не является валидным UTF-8`);
    continue;
  }

  // 3. Символ замены — признак потерянной кодировки
  if (text.includes('\uFFFD')) {
    problems.push(`${rel}: содержит символ U+FFFD (потеря кодировки)`);
  }
}

let failed = false;

if (ps1WithoutBom.length > 0) {
  failed = true;
  console.error('\nPowerShell-скрипты без UTF-8 BOM:');
  for (const file of ps1WithoutBom) console.error(`  ${file}`);
  console.error('\nPowerShell 5.1 читает такой файл как ANSI и ломается на кириллице.');
  console.error('Исправление: node scripts/fix-encoding.mjs');
}

if (problems.length > 0) {
  failed = true;
  console.error('\nПроблемы с кодировкой:');
  for (const problem of problems) console.error(`  ${problem}`);
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log(`[check-encoding] ОК: проверено ${checked} текстовых файлов.`);
}
