const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

// Define the path correctly
const serviceAccount = {
 main
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

  type: "service_account",
  project_id: "crypto-bot-5f3c8",
  private_key_id: "1d2f36971245c27985ede2032e23f67b03f8a337",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCfBWeMM3t9HXhH\nYYk1Hh7XCi50nBfwJIB3qKR7ZHoPgEEW2dNgY857oz1yjOkNQfrINjX2vXOzIYMb\nRodKyOW4OczRI6eRgu6w+EcRVumlz70NFuBorZsZllmeZ4ifhFxyqdYCGoFTrGgM\n/JOwTmdoTK6pk8xjjLgqml3owKmCTpdT/lM6exJEK7o/9S0vi+EdU6EsgwFLIS+k\nffOdakoguRVUXEbytpKxSSUAaDf4jLWnvlU+J1gZPPFMEDg+0Wq4hnggKt9rcgL+\n7mrBX4OH7+c56tK2BeBGaR38AHRJ3g/X8PZ8PwIASbv2IEokVEmWEbNOvfmtIhmD\n2rRSsiaHAgMBAAECgf9lj44SfM7hmXC4JhL7WcFYlagV0Zt4Q9fIlGx4YjOSstbf\nQT8+0H+PdzJHdrdhQEJqnDTa4SSDw2N4iBLgMG6GumOVLrBWvsizPd4ltNyEiai0\nM2gfcsEcFmomQPmA54gjs1R7A3KVfgb2RFoOwARLGK50n3BqI/V7QBu6C1I3Zff/\nZ1Pk4wS9lPh0xj7Yoe8Pb6E/0CT+m4+eoVTYYm8RXKLmZgngu5tPYghv6e5pvF+/\nRrDyN0NydzPtaC40d2dbS/FyRzDxdRIwXnkspkTPt1ZsiDNbpMZ89ahH7L1iY2fF\naJSBb7u2OkId/PqjgdkgUhfQ1InfyJdSlPs5d1UCgYEA1xygUAJmajRXnr4/PaV1\n1ItnwYmPtwIte6GFogIwcxoplYjxWWtzrZdECwKZXSSDOkN5uhcjkvyfR9VEu4i6\nvMcNgkrXNoYURtBEW4WNgA7/2VrO3/5eEGVy93foevk8loTwiVsC0SJdDDVCOy0j\n40eVQagSoqCX2SfQVkSkLU0CgYEAvT9lVPRq6NdN58cAxqQcqA9ikp/ofwntWmhx\nva51ryx1WD2pp2tviwD78+mJYolm+j50dTnzAFrjGl2SKx37G9KgauJKDMHnf6wE\nnm6D0KWVylMtwln0UzIDO0bmnszoQw5mbtR8y6TWB62xSLMZt4Q9eHu7OcM6c9zx\nn1YpSSMCgYAFAJFpyuR+y8DN3Da0REi9LJC5G23QH6jXGyZ0YgCmbJFS/OA/6BPE\nkaPvbZwLYnH6xN7ryOX24REDJp52jfNpuGdEBGGEzxFhpC4ywqRLug2RDF+LLesa\nDoHh51PsqCcUiPre9tLV8iqfwg1MOvx+qId8A2CLj5h4YEij+OyocQKBgQCIiJ5g\n5l3jUsJf/9DtfyU1krP5OOkSDmVxnnzA7ob1NMwMN6CYqwg0bydXWBvIPX1P+ZMn\nqAFLNkc2lF+KP/0Um6cktdHa1mJgWAiVDQKIm44wBEa1OxTsmN5/+60S0J6ZEmCQ\ngTjv6yKHM6b93kklf4Ch1hLDn7giMzsXS6BJpQKBgQCyb69eLevN2MGeYiAOqz6s\nfR7EY9nh7S2XkpAmWXepddIi76hnsfseXJSTKhVK+x/QMv3wo6JouQDluBLpLuFm\nz3iKacf1f44nckVATO/UtcTZJDm9y5ciGLFTnbK4EQxBGlDpSZ0gh2NY+e1vEweE\n+aTK4+00mfz2+Vj97aqkxg==\n-----END PRIVATE KEY-----\n",
  client_email:
    "firebase-adminsdk-fbsvc@crypto-bot-5f3c8.iam.gserviceaccount.com",
  client_id: "110753494201191022457",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url:
    "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40crypto-bot-5f3c8.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
 master
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

logger.info(" Firebase Admin SDK initialized successfully.");

module.exports = admin;
