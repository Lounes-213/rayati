const fs = require('fs');
const jsFiles = fs.readdirSync('C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\js');
for (const f of jsFiles) {
  const code = fs.readFileSync('C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\js\\' + f, 'utf8');
  const idx = code.indexOf('BACKEND_API_URL');
  if (idx !== -1) {
    console.log(f, code.substring(Math.max(0, idx - 50), idx + 80));
  }
}
