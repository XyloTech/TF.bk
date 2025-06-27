const { exec } = require('child_process');
const mongoose = require('mongoose');
const User = require('./models/User'); 

require('dotenv').config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const userCount = await User.countDocuments();
  const workersNeeded = Math.ceil(userCount / 200);

  console.log(`Spawning ${workersNeeded} workers for ${userCount} users`);

  exec(`pm2 list`, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to list PM2 processes:', err);
      return;
    }

    let currentInstances = 0;
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (line.includes('botmoon-worker') && line.includes('online')) {
        currentInstances++;
      }
    }

    if (currentInstances === workersNeeded) {
      console.log(`Already ${workersNeeded} workers running. No scaling needed.`);
      return;
    }

    exec(`pm2 scale botmoon-worker ${workersNeeded}`, (err, stdout, stderr) => {
      if (err) {
        console.error('Failed to scale PM2:', err);
        return;
      }
      console.log(stdout);
    });
  });
})();