#!/usr/bin/env node
/**
 * Автоисправление BOM в PowerShell-скриптах.
 *
 * Зачем отдельный скрипт: BOM легко потерять при правке файла любым
 * редактором, который его не сохраняет. Восстанавливать вручную — значит
 * каждый раз помнить. Здесь это одна команда.
 *
 * Запуск:  node scripts/fix-encoding.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.local', 'coverage']);
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

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

let fixed = 0;

for (const file of walk(ROOT)) {
  if (extname(file).toLowerCase() !== '.ps1') continue;

  const buffer = readFileSync(file);
  if (buffer.subarray(0, 3).equals(BOM)) continue;

  // Файл без BOM читаем как UTF-8 и сохраняем с BOM.
  // Если он не UTF-8 — не трогаем: молча «починить» такую строку нельзя.
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    console.warn(`  пропущен (не UTF-8): ${relative(ROOT, file)}`);
    continue;
  }

  writeFileSync(file, Buffer.concat([BOM, Buffer.from(text, 'utf8')]));
  console.log(`  BOM добавлен: ${relative(ROOT, file)}`);
  fixed += 1;
}

console.log(fixed === 0 ? '[fix-encoding] Все .ps1 уже с BOM.' : `[fix-encoding] Исправлено файлов: ${fixed}.`);
