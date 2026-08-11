import net from 'node:net';
// Coyote Claw — Mission Control tailnet forwarder: 100.80.56.91:8787 -> 127.0.0.1:8787
// No-sudo alternative to `tailscale serve`. Per-connection pipe; exits non-zero if the
// tailnet IP isn't bindable yet (e.g. early boot) so systemd Restart=always retries.
const TS_IP = '100.80.56.91', PORT = 8787;
const server = net.createServer((client) => {
  const up = net.connect(PORT, '127.0.0.1');
  client.pipe(up); up.pipe(client);
  client.on('error', () => up.destroy());
  up.on('error', () => client.destroy());
});
server.on('error', (e) => { console.error('forwarder error: ' + e.message); process.exit(1); });
server.listen(PORT, TS_IP, () => console.log(`forwarder ${TS_IP}:${PORT} -> 127.0.0.1:${PORT}`));
