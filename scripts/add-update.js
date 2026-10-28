// Adds a released version to updates.json, which Firefox reads to find new versions.
// Usage: node scripts/add-update.js <version> <download url> <path to .xpi>
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const [version, link, xpi] = process.argv.slice(2);
if (!version || !link || !xpi) {
  console.error('Usage: node scripts/add-update.js <version> <download url> <path to .xpi>');
  process.exit(1);
}

const file = path.join(__dirname, '..', 'updates.json');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const id = manifest.browser_specific_settings.gecko.id;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const entry = (data.addons[id] = data.addons[id] || { updates: [] });

const hash = crypto.createHash('sha256').update(fs.readFileSync(xpi)).digest('hex');
entry.updates = entry.updates.filter((u) => u.version !== version);
entry.updates.push({ version, update_link: link, update_hash: `sha256:${hash}` });

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`updates.json now lists ${version}`);
