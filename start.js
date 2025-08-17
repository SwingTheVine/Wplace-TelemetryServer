const { exec, spawn } = require('child_process');

// Option 1: simple execution (waits for completion)
//exec('sh ./start.sh', (error, stdout, stderr) => {
//  if (error) {
//    console.error(`Error executing script: ${error}`);
//    return;
//  }
//  console.log(`STDOUT: ${stdout}`);
//  console.error(`STDERR: ${stderr}`);
//});

// Option 2: spawn (runs in background, streams output)
const child = spawn('sh', ['./start.sh'], { stdio: 'inherit' });

child.on('close', (code) => {
  console.log(`Script exited with code ${code}`);
});
