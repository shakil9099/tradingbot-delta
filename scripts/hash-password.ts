// npm run hash-password  → reads a password from stdin, prints a bcrypt hash (cost 12) for DASHBOARD_PASSWORD_HASH.
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: process.stdin.isTTY });
process.stderr.write('Password: ');
rl.once('line', async (pw) => {
  rl.close();
  if (pw.length < 10) {
    console.error('\nUse at least 10 characters.');
    process.exit(1);
  }
  console.log('\n' + (await bcrypt.hash(pw, 12)));
});
