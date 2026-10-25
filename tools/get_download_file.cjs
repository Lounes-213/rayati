const fs = require('fs');
const c = fs.readFileSync('C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\js\\0ioltbsub2-fu.js', 'utf8');
const idx = c.indexOf('["downloadFile",0,l');
console.log(c.substring(Math.max(0, idx - 800), idx + 50));
