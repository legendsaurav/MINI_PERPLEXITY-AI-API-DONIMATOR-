const http = require('http');

const apiKey = 'sk-090f4b6cf0f24c8f95e511c734b54e45';
const query = 'hello how are things going';

const url = `http://127.0.0.1:9876/trigger/submit?api_key=${apiKey}&q=${encodeURIComponent(query)}`;

http.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => {
    console.log('Response:', data);
  });
}).on('error', (err) => console.error('Error:', err.message));
