#!/usr/bin/env node
/**
 * Starts Metro for the Platinum Circles dev client with the laptop's real network address.
 *
 * Why this exists: Expo CLI 54 asks a helper process (lan-network) for the LAN address and
 * gives it 500 ms to answer. On this laptop the helper does not answer in time, so Expo falls
 * back to 127.0.0.1 and tells the phone to connect to itself ("Failed to load app from
 * http://127.0.0.1:8081"). This script finds the address in-process, with no time limit, and
 * hands it to Expo through REACT_NATIVE_PACKAGER_HOSTNAME, which Expo uses as given.
 *
 *   npm run dev            same Wi-Fi as the laptop
 *   npm run dev-clear      same, with the bundler cache cleared
 *   npm run dev-tunnel     phone on another network (ngrok)
 *   node tools/dev-start.js --print-host     only print the address, do not start
 */
const os = require('os');
const dgram = require('dgram');
const path = require('path');
const { spawn } = require('child_process');

const VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|tailscale|zerotier|bluetooth|loopback|npcap|vpn|tap-|tun/i;

function isPrivate(ip) {
  return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

// The address of the interface that carries the default route: connect a UDP socket to a public
// address (no packet is sent) and read which local address the system picked.
function viaDefaultRoute() {
  return new Promise((resolve) => {
    let settled = false;
    const sock = dgram.createSocket('udp4');
    const done = (v) => { if (settled) return; settled = true; try { sock.close(); } catch {} resolve(v); };
    sock.once('error', () => done(null));
    try {
      sock.connect(53, '1.1.1.1', () => {
        try { const a = sock.address().address; done(a && a !== '0.0.0.0' && !a.startsWith('127.') ? a : null); } catch { done(null); }
      });
    } catch { done(null); }
    setTimeout(() => done(null), 1500);
  });
}

// Fallback: the best-looking real adapter, private ranges first, virtual adapters excluded.
function viaInterfaces() {
  const found = [];
  const all = os.networkInterfaces();
  for (const name of Object.keys(all)) {
    for (const a of all[name] || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      found.push({ name, address: a.address, virtual: VIRTUAL.test(name), priv: isPrivate(a.address) });
    }
  }
  found.sort((x, y) => (+x.virtual - +y.virtual) || (+y.priv - +x.priv));
  return found.length ? found[0].address : null;
}

(async () => {
  const args = process.argv.slice(2);
  const printOnly = args.includes('--print-host');
  const forced = (process.env.PLATINUM_DEV_HOST || '').trim();
  const ip = forced || (await viaDefaultRoute()) || viaInterfaces();

  const env = { ...process.env };
  delete env.EXPO_PACKAGER_PROXY_URL;
  if (ip) env.REACT_NATIVE_PACKAGER_HOSTNAME = ip; else delete env.REACT_NATIVE_PACKAGER_HOSTNAME;

  if (ip) console.log(`Phone connects to http://${ip}:8081 (this laptop's network address)`);
  else console.log('No network address found on this laptop, Expo will choose one itself');
  if (printOnly) process.exit(ip ? 0 : 2);

  const passthrough = args.filter((a) => a !== '--print-host');
  const hasHost = passthrough.some((a) => /^--(tunnel|lan|localhost|host)$/.test(a) || a.startsWith('--host='));
  const expoArgs = ['start', '--dev-client', ...(hasHost ? [] : ['--lan']), ...passthrough];
  const cli = require.resolve('expo/bin/cli', { paths: [path.join(__dirname, '..')] });
  const child = spawn(process.execPath, [cli, ...expoArgs], { stdio: 'inherit', env, cwd: path.join(__dirname, '..') });
  child.on('exit', (code) => process.exit(code == null ? 0 : code));
})();
