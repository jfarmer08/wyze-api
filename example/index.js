//const WyzeAPI = require('../src/index') // Local Debug
const WyzeAPI = require("wyze-api")
const Logger = require("@ptkdev/logger");

const logger = new Logger();

const options = {
  username: "username",
  password: "password",
  keyId: "keyId",
  apiKey: "apiKey",
  persistPath: "./scratch",
  logLevel: "debug",
  apiLogEnabled: true
}
const wyze = new WyzeAPI(options,logger)

  ; (async () => {

  const devices = await wyze.getDeviceList()
   logger.debug(JSON.stringify(devices))
  })()
