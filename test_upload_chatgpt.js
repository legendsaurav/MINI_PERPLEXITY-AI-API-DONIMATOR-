const fs = require('fs');
const path = require('path');
const http = require('http');

const readmePath = path.join(__dirname, 'README.md');
const readmeContent = fs.readFileSync(readmePath);
const readmeBase64 = readmeContent.toString('base64');

const postData = JSON.stringify({
  project: 'General',
  provider: 'chatgpt',
  text: 'ANALYSE IT AND TELL ME WHAT IS IT ABOUT',
  files: [
    {
      filename: 'README.md',
      mime_type: 'text/markdown',
      data: readmeBase64
    }
  ]
});

const options = {
  hostname: 'localhost',
  port: 8080,
  path: '/v1/chat',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer sk-2ffc5d5769594673b2ae8b5173108d91',
    'Content-Length': Buffer.byteLength(postData)
  }
};

console.log('Sending chat request with README.md uploaded to Go backend...');

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}\n`);
  
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    // Print streamed chunks to stdout as they arrive
    process.stdout.write(chunk);
  });
  
  res.on('end', () => {
    console.log('\n--- Stream Ended ---');
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();
