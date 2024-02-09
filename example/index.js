require('dotenv').config()

let WyzeAPI = null;
if (process.env.LOCAL_DEV) {
  WyzeAPI = require('../src/index'); // Local Debug
} else {
  WyzeAPI = require("wyze-api");
}

const Logger = require("@ptkdev/logger");
const logger = new Logger();

const options = {
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH,
  logLevel: process.env.LOG_LEVEL,
  apiLogEnabled: process.env.API_LOG_ENABLED,
}
const wyze = new WyzeAPI(options, logger);

async function loginCheck(iterations = 2) {
  var count = 0;
  while (count < iterations) {
    await wyze.maybeLogin();
    wyze.access_token = "";
    count += 1;
  }
}

async function deviceListCheck() {
  const devices = await wyze.getDeviceList()
  logger.debug(JSON.stringify(devices))
}


(async () => {
   await deviceListCheck();
  // await loginCheck(4);
})()
