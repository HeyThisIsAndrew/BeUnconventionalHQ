import { spawn } from 'child_process';
import os from 'os';
import qrcode from 'qrcode-terminal';

const PORT = 4321;
const BASE_PATH = '/BeUnconventionalHQ/';

// Get local network IP
function getNetworkIP() {
  const nets = os.networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const ip = getNetworkIP();
const localUrl = `http://localhost:${PORT}${BASE_PATH}`;
const networkUrl = `http://${ip}:${PORT}${BASE_PATH}`;

// Print URLs
console.log('\n🚀 Dev server starting...\n');
console.log('📱 Local:');
console.log(localUrl);
console.log('\n📱 Network:');
console.log(networkUrl);

// QR code (for mobile)
console.log('\n📲 Scan to open:');
qrcode.generate(networkUrl, { small: true });

// Start Astro dev server (IMPORTANT: keep this last)
const astro = spawn(
  'npx',
  ['astro', 'dev', '--host', '0.0.0.0', '--port', PORT],
  {
    stdio: 'inherit',
    shell: true,
  }
);

astro.on('exit', (code) => {
  console.log(`\nAstro exited with code ${code}`);
});
