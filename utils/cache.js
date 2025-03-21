const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 300, checkperiod: 320 }); // 5 min cache

// 🔹 Set cache
const setCache = (key, value, ttl = 300) => {
  cache.set(key, value, ttl);
};

// 🔹 Get from cache
const getCache = (key) => {
  return cache.get(key);
};

// 🔹 Delete cache
const deleteCache = (key) => {
  cache.del(key);
};

// 🔹 Clear all cache
const clearCache = () => {
  cache.flushAll();
};

module.exports = { setCache, getCache, deleteCache, clearCache };
