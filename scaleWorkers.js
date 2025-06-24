const { exec } = require('child_process');
const mongoose = require('mongoose');
const User = require('./models/User'); 

(async () => {
  await mongoose.connect('mongodb://localhost:27017/your-db');

  const userCount = await User.countDocuments();
  const workersNeeded = Math.ceil(userCount / 200);

  console.log(`Spawning ${workersNeeded} workers for ${userCount} users`);

  exec(`pm2 scale botmoon-worker ${workersNeeded}`, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to scale PM2:', err);
      return;
    }
    console.log(stdout);
  });
})();