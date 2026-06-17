// Generates UNICODE_TO_SLACK from the gemoji dataset (GitHub/Slack compatible names).
// Run: cd scripts && npm install && node generate-emoji-map.mjs
// Paste the output into worker/index.js to replace UNICODE_TO_SLACK.

import { gemoji } from 'gemoji';

const map = new Map();

for (const entry of gemoji) {
  if (!entry.emoji || !entry.names.length) continue;

  const name = entry.names[0];

  // Base emoji
  if (!map.has(entry.emoji)) map.set(entry.emoji, name);

  // Skin tone variants
  if (entry.skintones) {
    for (const variant of entry.skintones) {
      if (variant.emoji && variant.names.length && !map.has(variant.emoji)) {
        map.set(variant.emoji, variant.names[0]);
      }
    }
  }
}

// Sort by codepoint for stable diffs
const sorted = [...map.entries()].sort(([a], [b]) => {
  const ca = [...a].map(c => c.codePointAt(0));
  const cb = [...b].map(c => c.codePointAt(0));
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] !== cb[i]) return ca[i] - cb[i];
  }
  return ca.length - cb.length;
});

process.stdout.write('// Auto-generated — do not edit by hand.\n');
process.stdout.write('// Regenerate: cd scripts && npm install && node generate-emoji-map.mjs\n');
process.stdout.write(`// ${sorted.length} entries from gemoji ${(await import('gemoji/package.json', { with: { type: 'json' } })).default.version}\n`);
process.stdout.write('const UNICODE_TO_SLACK = {\n');
for (const [char, name] of sorted) {
  process.stdout.write(`  ${JSON.stringify(char)}:${JSON.stringify(name)},\n`);
}
process.stdout.write('};\n');
