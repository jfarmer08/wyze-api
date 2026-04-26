// Wyze Robot Vacuum example: list vacuums, read status, and run a clean cycle.
//
// Usage:
//   LOCAL_DEV=1 node example/vacuum.js                   # list + status
//   LOCAL_DEV=1 node example/vacuum.js clean             # start cleaning
//   LOCAL_DEV=1 node example/vacuum.js dock              # send to dock
//   LOCAL_DEV=1 node example/vacuum.js suction quiet     # quiet | standard | strong
require("dotenv").config();

let WyzeAPI = null;
if (process.env.LOCAL_DEV) {
  WyzeAPI = require("../src/index");
} else {
  WyzeAPI = require("wyze-api");
}

const wyze = new WyzeAPI({
  username: process.env.USERNAME,
  password: process.env.PASSWORD,
  keyId: process.env.KEY_ID,
  apiKey: process.env.API_KEY,
  persistPath: process.env.PERSIST_PATH,
  apiLogEnabled: process.env.API_LOG_ENABLED === "true",
});

const SUCTION_MAP = {
  quiet: WyzeAPI.VacuumSuctionLevel.QUIET,
  standard: WyzeAPI.VacuumSuctionLevel.STANDARD,
  strong: WyzeAPI.VacuumSuctionLevel.STRONG,
};

async function main() {
  const [, , command, arg] = process.argv;

  const vacuums = await wyze.getVacuumDeviceList();
  if (vacuums.length === 0) {
    console.log("No robot vacuums found on this account.");
    return;
  }

  const vacuum = vacuums[0];
  console.log(`Vacuum: ${vacuum.nickname} (${vacuum.mac}, ${vacuum.product_model})`);

  if (!command) {
    const status = await wyze.getVacuumStatus(vacuum.mac);
    const props = await wyze.getVacuumIotProp(vacuum.mac, ["mode", "battary", "cleanlevel"]);
    console.log("Status:", JSON.stringify(status, null, 2));
    console.log("Props :", JSON.stringify(props, null, 2));
    return;
  }

  switch (command) {
    case "clean":
      console.log(await wyze.vacuumClean(vacuum.mac));
      break;
    case "pause":
      console.log(await wyze.vacuumPause(vacuum.mac));
      break;
    case "dock":
      console.log(await wyze.vacuumDock(vacuum.mac));
      break;
    case "stop":
      console.log(await wyze.vacuumStop(vacuum.mac));
      break;
    case "rooms": {
      const ids = (arg || "").split(",").map((n) => parseInt(n, 10)).filter(Number.isFinite);
      if (ids.length === 0) throw new Error("Pass room ids: rooms 11,14");
      console.log(await wyze.vacuumSweepRooms(vacuum.mac, ids));
      break;
    }
    case "suction": {
      const level = SUCTION_MAP[String(arg).toLowerCase()];
      if (!level) throw new Error("Suction must be quiet|standard|strong");
      console.log(await wyze.vacuumSetSuctionLevel(vacuum.mac, vacuum.product_model, level));
      break;
    }
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
