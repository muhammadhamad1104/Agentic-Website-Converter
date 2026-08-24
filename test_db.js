const axios = require('axios');
const sqlite3 = require('sqlite3');

const db = new sqlite3.Database('apps/worker/data/conversion_jobs.db', (err) => {
  if (err) console.error(err.message);
});

db.all("SELECT id, crawl_artifacts, extraction_report FROM conversion_jobs LIMIT 3", [], (err, rows) => {
  if (err) throw err;
  rows.forEach(row => {
    const ca = JSON.parse(row.crawl_artifacts || '{}');
    const er = JSON.parse(row.extraction_report || '{}');
    console.log(`Job: ${row.id}`);
    console.log(`crawl_artifacts.assets type:`, Array.isArray(ca.assets) ? 'array' : typeof ca.assets);
    if (ca.assets) console.log(`crawl_artifacts.assets length:`, ca.assets.length);
    console.log(`crawl_artifacts.totals:`, ca.totals);
    console.log(`extraction_report.assets type:`, Array.isArray(er.assets) ? 'array' : typeof er.assets);
  });
});
