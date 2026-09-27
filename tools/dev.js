const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('🚀 Launching Retribution Digital Twin (Backend on :4000 & Frontend on :3000)...');

const server = spawn(npmCmd, ['run', 'dev'], { cwd: path.join(root, 'server'), stdio: 'inherit', shell: true });
const web = spawn(npmCmd, ['run', 'dev'], { cwd: path.join(root, 'web'), stdio: 'inherit', shell: true });

function cleanup() {
  try { server.kill(); } catch (e) {}
  try { web.kill(); } catch (e) {}
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
