require("dotenv").config();

let WyzeAPI = null;
if (process.env.LOCAL_DEV) {
  WyzeAPI = require("../src/index"); // Local Debug
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
};

logger.debug(`Starting WyzeAPI with options: ${JSON.stringify(options)}`);

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
  //const devices = await wyze.getDeviceByMac('7C78B2OA4ECO')
  const devices = await wyze.getDeviceByName('Bob')
  logger.debug(JSON.stringify(devices));
  const cleaner = await wyze.setVacuumCleanStart(devices.mac)
  //const bulb = await wyze.localBulbCommand(devices.product_model,devices.mac,devices.enr,devices.device_params.ip, "P3", "1")
  logger.debug(JSON.stringify(cleaner));
}

(async () => {
  //await wyze.maybeLogin();
  await deviceListCheck();
  //const ddd = await wyze.encrypt("33333333333333","333")
  //logger.debug(ddd)
  // await loginCheck(4);
})();
