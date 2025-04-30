// /services/freqtrade/dbUrls.js

const path = require("path");

function resolveDatabaseUrl(instanceIdStr, instanceUserDataPath) {
  const {
    FT_PG_USER,
    FT_PG_PASSWORD,
    FT_PG_HOST,
    FT_PG_PORT = "5432",
    FT_PG_DATABASE,
  } = process.env;

  if (FT_PG_USER && FT_PG_PASSWORD && FT_PG_HOST && FT_PG_DATABASE) {
    return `postgresql+psycopg2://${encodeURIComponent(
      FT_PG_USER
    )}:${encodeURIComponent(
      FT_PG_PASSWORD
    )}@${FT_PG_HOST}:${FT_PG_PORT}/${FT_PG_DATABASE}`;
  }

  const localDbFile = path.join(instanceUserDataPath, "tradesv3.sqlite");
  return `sqlite:///${localDbFile.replace(/\\/g, "/")}`;
}

module.exports = {
  resolveDatabaseUrl,
};
