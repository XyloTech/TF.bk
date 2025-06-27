const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

// Define the path correctly
const serviceAccount = {
  "type": "service_account",
  "project_id": "moonbot-3255e",
  "private_key_id": "602ad9823f4c4c1889863d1d9ddd08083a5e7d29",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCr+P+HJ/Ow6ACV\n8FP0YRgXCYALMG3a7/X/Os8IkI4cW2VS3S41cjnliLoCCZ+75c5cUw2JZBmDScJQ\n5A37IN8EZwobB8KrEX2Z77nThSnBCmwOEVaeByowJkQqHr6QJbkrDlnhUfxeikGd\nMfYDQ4LQ1vhK/zBKkPad6GgxO6fnnkrPU1MUSqLXQqRY1fkbcCjUZ537mxVk4WlB\nC4KSWSjg7vgbEiQZgeXCeXkk55/QbA6cE4K+bDjc7TzOA9m5w/0b4rKz4aeNRYye\nt3yD7qeyTXHfq6lMK3CbG4x5htVbfr2TFVCXqdHy8T5yhHt8mbURN6L3fq2oMKqI\n7d4oyAvhAgMBAAECggEAHI5nzAcn0ZfsxPkXz8wxpl2m+/SqQUE4bY3T5B2w42eP\nzy84JZrWn1VRYdY8RoS1/CG0bTyIegMM98auxaUjM0Vy6aMjwalRXHbwuf1yPgJf\niAR8CBizejRYfFAHn8ML2Oj0ptQo3oABvjsWGVukBM61gyqV18Pzl6wIZSh9TJn4\nEE8wuqsiGaJFDprTcOhAl0phMvPN567shoDgO0+Y4FgOc5Q/4tkRuIZ+vPIOhmSE\n+mxL2SElGuaBsptUMyxTF9y8Xc65dCmXnR0EFSGQB/XIeE2Y9SItInRZhV2b4kpj\n7RHOj0qAfMRUvl7wh6nWSt2rYvVzgZy9q11KO2OE6wKBgQDeVs6VPLW17P7zwczW\nB8uJCTmR6d0K2dPRGbXdWIY3I9jpFA3LKQuZLWJfNnRF2YL//mTVgju0q18vGGbQ\naqpFoNIYBC0Nv6pU7vjGqIYTVsTuBR3cf4aek9C0f7AgQfGKCImtJvcuAhnDp+rD\nN39rnHAQpl7eFbMOIEY/JwEsrwKBgQDGAiPGU2pUM+XKC8C3oBauLXa/krx06EJd\nlKEg4BuC7h+gQu2KrbO3/aM6RD9aMGzvisY6x+MR4Ko7pi5ZRFx1twgVSt4gU+1k\nY5g+eCJALSX2fvYrfWZqrDUwvRvBmu1ZwcM4/eYyzrlzdXx+WfW4S+hSomdNFUQ9\ntd+PFrgUbwKBgAlSon7neMcUFOyrp6ch1Ir+dAeGQtp9n8AYz+NkHtyZCDNdv+ZQ\n5keZ+5H6eo2jPTb2t8usFkzREsCqyUTb9B/PSn/vTORSsRW2n3/U+So+bSt90263\nejGUCSBIal4v5azgBsXX6G1pcSMfG1zsKs+cU6afE0NErald+RQU0pvJAoGBAJIC\nJesqu29XzYxNWlCNRewuLjBZvYnfcoCbBq29U8waV0vPzmXCbJGyAFkI1kZlCw8g\nH8hceP5H0n+lrOu6Uwuiad15lY31FUo/fpYh8++q2yGGwXOURp9GWPqVmBANdBQJ\nozE1WDgC5BFVgvWQ1HaP0sKMauwWUHnI0Q8sS5UVAoGAKKFYB7q0AvG9zehnRLeK\nyJBhvqXoJ4v99KEwmpRzdB50qxMkkXcq2j8rns+Jhwi+VEGL3n09Iz99dlP2Rsny\nc3qMRv7UmfRjacAc9+g6o4JdxuYSU9tYRrWPVWYux815aGb/e0z3DgeSKf2SnZQ4\nCLkn9kDdMXb1y3WSyR+tUDo=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@moonbot-3255e.iam.gserviceaccount.com",
  "client_id": "103769850944860172565",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40moonbot-3255e.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

logger.info(" Firebase Admin SDK initialized successfully.");

module.exports = admin;
