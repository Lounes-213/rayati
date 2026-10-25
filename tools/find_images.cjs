const fs = require('fs');
const file = 'C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\index.html';
const raw = fs.readFileSync(file, 'utf8');
const html = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

// Find all occurrences of image paths or IDs
const regex = /"fileImageId":"([^"]+)"/g;
let m;
const ids = new Set();
while ((m = regex.exec(html)) !== null) {
  ids.add(m[1]);
}
console.log('Image IDs found:', Array.from(ids));

// Search for any URL that contains these IDs or contains image paths
for (const id of Array.from(ids)) {
  const match = raw.match(new RegExp(`[^"']*${id}[^"']*`, 'g'));
  if (match) {
    console.log(`Matches for ${id}:`, match.slice(0, 3));
  }
}

// Search for digiticket image base URL in js files or html
const jsDir = 'C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\js';
const jsFiles = fs.readdirSync(jsDir);
for (const jf of jsFiles) {
  const content = fs.readFileSync(`${jsDir}\\${jf}`, 'utf8');
  const imgUrlMatches = content.match(/https?:\/\/[^"'\s]+\/api\/[^"'\s]+/gi) || [];
  if (imgUrlMatches.length > 0) {
    console.log(`API matches in ${jf}:`, imgUrlMatches.slice(0, 5));
  }
  const fileMatches = content.match(/\/files\/[a-zA-Z0-9_-]+/gi) || [];
  if (fileMatches.length > 0) {
    console.log(`File matches in ${jf}:`, fileMatches.slice(0, 5));
  }
}
