const Queue = require('bull');

// Create a new queue named 'exchangeQueue'
const exchangeQueue = new Queue('exchangeQueue', 'redis://127.0.0.1:6379');

exchangeQueue.process(async (job) => {
  console.log(`Processing job ${job.id} with data:`, job.data);
  // Simulate an asynchronous task, e.g., an API call to an exchange
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log(`Finished processing job ${job.id}`);
  return { status: 'completed', message: `Job ${job.id} processed successfully` };
});

exchangeQueue.on('completed', (job, result) => {
  console.log(`Job ${job.id} completed with result ${result.status}`);
});

exchangeQueue.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed with error ${err.message}`);
});

module.exports = exchangeQueue;