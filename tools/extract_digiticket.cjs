const fs = require('fs');

const file = 'C:\\Users\\bense\\Downloads\\saveweb2zip-com-digiticket-dz\\index.html';
const raw = fs.readFileSync(file, 'utf8');
const html = raw.replace(/\\"/g, '"').replace(/\\\\/g, '\\');

// Regex to capture full infrastructure objects
const infraRegex = /"infrastructure":\s*(\{[^}]+\})/g;
let m;
const stadiums = [];
const seen = new Set();

const allInfrasRegex = /"annee":(\d+),"capacite":(\d+),"designation":"([^"]+)","etatInfra":"[^"]+","fileImageId":"([^"]+)".*?"slug":"([^"]+)"/g;
while ((m = allInfrasRegex.exec(html)) !== null) {
  const annee = m[1];
  const cap = m[2];
  const name = m[3];
  const imgId = m[4];
  const slug = m[5];
  if (!seen.has(name)) {
    seen.add(name);
    stadiums.push({ name, cap: Number(cap), annee: Number(annee), imgId, slug });
  }
}

// Another pattern where fields are in different order
const allInfrasRegex2 = /"designation":"([^"]+)","etatInfra":"[^"]+","fileImageId":"([^"]+)".*?"slug":"([^"]+)"/g;
while ((m = allInfrasRegex2.exec(html)) !== null) {
  const name = m[1];
  const imgId = m[2];
  const slug = m[3];
  if (!seen.has(name)) {
    seen.add(name);
    stadiums.push({ name, imgId, slug });
  }
}

console.log('Complete Stadiums Count:', stadiums.length);
console.log(JSON.stringify(stadiums, null, 2));

// Matches extraction
const matches = [];
const matchRegex = /"isMatch":true.*?"libelle":"([^"]+)".*?"phase":"([^"]+)".*?"prixMin":(\d+).*?"dateEvenement":"([^"]+)".*?"designation":"([^"]+)"/g;
while ((m = matchRegex.exec(html)) !== null) {
  matches.push({
    match: m[1],
    phase: m[2],
    price: m[3],
    date: m[4],
    stadium: m[5],
  });
}
console.log('Matches Count:', matches.length);
console.log(JSON.stringify(matches, null, 2));
