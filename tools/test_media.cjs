const https = require('https');

const id = 'a70890ee-8a27-44b2-a9d4-c9338635be22';
const urls = [
  `https://digiticket.dz/media/download/${id}`,
  `https://api.digiticket.dz/media/download/${id}`,
  `https://backend.digiticket.dz/media/download/${id}`,
  `https://digiticket.dz/api/v1/media/download/${id}`,
  `https://digiticket.dz/api/media/download/${id}`
];

async function check() {
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(u, '->', res.status, res.headers.get('content-type'));
    } catch (e) {
      console.log(u, '-> Error:', e.message);
    }
  }
}
check();
