const axios = require('axios');

const API_URL = 'http://localhost:5000/api';
let token = '';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  try {
    console.log('1. Logging in...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'muhammadhamad1104@gmail.com',
      password: 'Muhammad11@H'
    });
    token = loginRes.data.token;
    console.log('Login successful! Token acquired.');

    console.log('2. Creating Site (https://kubernetes.io/)...');
    const siteRes = await axios.post(`${API_URL}/sites`, {
      name: 'Kubernetes Test',
      sourceType: 'URL',
      sourceUrl: 'https://kubernetes.io/',
      outputStack: 'react+node'
    }, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const site = siteRes.data.site;
    const siteId = site.id;
    console.log(`Site created successfully! ID: ${siteId}, Status: ${site.status}`);

    console.log('3. Simulating Payment Success for this site (to trigger AI / Crawl)');
    // Since Stripe webhook is hard to trigger, we might be able to call the crawl or trigger it directly.
    // Let's see if the site status is already analyzing or we need to trigger it.
    console.log('Current site status:', site.status);

    // Poll for status
    console.log('4. Polling for site status...');
    let currentStatus = site.status;
    let attempts = 0;
    while (currentStatus !== 'READY' && currentStatus !== 'DEPLOYED' && currentStatus !== 'FAILED' && attempts < 120) {
      const pollRes = await axios.get(`${API_URL}/sites/${siteId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      currentStatus = pollRes.data.site.status;
      console.log(`[Attempt ${attempts}] Status: ${currentStatus}`);
      await delay(5000);
      attempts++;
    }

    if (currentStatus === 'FAILED') {
      console.log('Process FAILED! We need to fix the backend.');
    } else {
      console.log('Process completed successfully with status:', currentStatus);
    }
  } catch (error) {
    console.error('Error in flow:', error.response?.data || error.message);
  }
}

run();
