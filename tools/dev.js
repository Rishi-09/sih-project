const { spawn } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const pythonCmd = isWin ? 'python' : 'python3';

console.log('================================================================');
console.log('  🚀 Retribution Digital Twin: Starting Full Synchronized Stack');
console.log('  1. Python Physics + ML Simulator  -> ws://localhost:8766');
console.log('  2. Node.js Telemetry & Engine API -> http://localhost:4000');
console.log('  3. Next.js Tactical Web Console   -> http://localhost:3000');
console.log('================================================================\n');

const children = [];

function spawnProcess(name, cmd, args, cwd) {
  console.log(`[${name}] Launching in ${cwd}...`);
  const proc = spawn(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
  });

  proc.on('close', (code) => {
    if (code !== 0 && code !== null) {
      console.log(`[${name}] Process exited with code ${code}`);
    }
  });

  children.push({ name, proc });
  return proc;
}

// 1. Python Physics & ML Simulator (ws://localhost:8766)
const sim = spawnProcess('SIMULATOR', pythonCmd, ['run_ws_only.py'], path.join(root, 'retribution'));

// 2. Node Backend Engine (port 4000)
const server = spawnProcess('SERVER', npmCmd, ['run', 'dev'], path.join(root, 'server'));

// 3. Next.js Web Console (port 3000)
const web = spawnProcess('WEB', npmCmd, ['run', 'dev'], path.join(root, 'web'));

function cleanup() {
  console.log('\n[RETRIBUTION] Stopping all services...');
  for (const { name, proc } of children) {
    try {
      if (isWin) {
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t']);
      } else {
        proc.kill('SIGTERM');
      }
    } catch (e) {}
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
