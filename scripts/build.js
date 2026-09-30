const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = ['index.html', 'style.css', 'engine.js', 'app.js'];

// Publish only browser assets. Never include local server, tests or browser profiles.
for (const file of files) {
  if (!fs.statSync(path.join(root, file)).isFile()) throw new Error(`Missing source file: ${file}`);
}
if (fs.existsSync(output)) {
  if (fs.lstatSync(output).isSymbolicLink() || !fs.lstatSync(output).isDirectory()) {
    throw new Error('dist must be a regular directory inside this project.');
  }
  const unexpected = fs.readdirSync(output).filter(file => !files.includes(file));
  if (unexpected.length) throw new Error(`Unexpected files in dist; review before publishing: ${unexpected.join(', ')}`);
}
fs.mkdirSync(output, { recursive: true });
for (const file of files) {
  const target = path.join(output, file);
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${target}`);
  fs.copyFileSync(path.join(root, file), target);
}
console.log(`Cloudflare Pages build ready: ${output}`);
console.log(`Published assets: ${files.join(', ')}`);
