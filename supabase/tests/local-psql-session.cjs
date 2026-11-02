// Real independent connections for lock tests. This helper deliberately accepts
// only a local Unix socket and an explicitly named disposable test database.
const { spawn } = require('node:child_process');
let serial = 0;
class LocalPsqlSession {
  constructor() {
    if (!process.env.PC_TEST_PSQL || !process.env.PGHOST?.startsWith('/')
        || !/^pc_scale_[a-z0-9_]+$/.test(process.env.PGDATABASE || '')) {
      throw new Error('Set PC_TEST_PSQL, a Unix-socket PGHOST and a disposable pc_scale_* PGDATABASE.');
    }
    this.child = spawn(process.env.PC_TEST_PSQL, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-P', 'pager=off'], { env: process.env });
    this.buffer = ''; this.errors = ''; this.active = null; this.ended = false;
    this.closed = new Promise(resolve => { this.onClose = resolve; });
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      this.buffer += chunk;
      if (!this.active) return;
      const end = this.buffer.indexOf(this.active.marker + '\n');
      if (end < 0) return;
      const value = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + this.active.marker.length + 1);
      const { resolve } = this.active; this.active = null; resolve(value);
    });
    this.child.stderr.on('data', chunk => { this.errors += chunk; });
    this.child.on('error', error => { this.active?.reject(error); this.active = null; });
    this.child.on('close', code => {
      this.ended = true;
      this.active?.reject(new Error(this.errors || `psql closed with code ${code}`)); this.active = null;
      this.onClose();
    });
  }
  query(sql) {
    if (this.active || this.ended) return Promise.reject(new Error('Session is busy or closed.'));
    const marker = 'PC_TEST_END_' + (++serial);
    return new Promise((resolve, reject) => {
      this.active = { marker, resolve, reject };
      this.child.stdin.write(sql + `\n;select '${marker}';\n`);
    });
  }
  async close() {
    if (!this.ended) this.child.stdin.end('\\q\n');
    await this.closed;
  }
}
module.exports = { LocalPsqlSession };
