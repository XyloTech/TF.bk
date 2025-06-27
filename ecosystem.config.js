module.exports = {
  apps : [{
    name   : "botmoon-worker",
    script : "server.js",
    instances: "max",
    exec_mode: "cluster",
      node_args: '--require dotenv/config',
    env: {
      PORT: 5003,
      NODE_ENV: 'development',
    },
    increment_var: 'PORT',
  }]
};