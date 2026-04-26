# Robot Vacuum

Wyze Robot Vacuum (`JA_RO2`). Communicates with the **Venus** service (`wyze-venus-service-vn.wyzecam.com`) using a separate auth/signing scheme from the rest of the library.

Added in **v1.1.11**. Resolves [#4](https://github.com/jfarmer08/wyze-api/issues/4). Patterned after [shauntarves/wyze-sdk's vacuums client](https://github.com/shauntarves/wyze-sdk/blob/master/wyze_sdk/api/devices/vacuums.py) but reshaped to this repo's thin-wrapper conventions plus device-object/pure-accessor helper layers.

## Quickstart

```js
const Wyze = require("wyze-api");
const wyze = new Wyze({ /* see Getting Started */ });

const [vacuum] = await wyze.getVacuumDeviceList();
if (!vacuum) return;

const info = await wyze.vacuumInfo(vacuum);
console.log(`Battery: ${wyze.vacuumGetBattery(info)}%`);
console.log(`Mode:    ${wyze.vacuumGetMode(info)}`);
console.log(`Docked:  ${wyze.vacuumIsDocked(info)}`);

await wyze.vacuumStartCleaning(vacuum);
// ...later
await wyze.vacuumReturnToDock(vacuum);
```

## Lookup

| Method | Returns |
|---|---|
| `getVacuumDeviceList()` | All `JA_RO2` devices on the account |
| `getVacuum(mac)` | Single device by mac |
| `getVacuumInfo(mac)` | **Combined snapshot** — list entry + iot props + device info + status + position + map. Tolerates partial sub-fetch failures. Returns `null` if the mac isn't a vacuum on the account. |
| `vacuumInfo(device)` | Same as `getVacuumInfo(device.mac)` — device-object form |

## Controls — device-object helpers (recommended)

```js
const v = await wyze.getVacuum(mac);

await wyze.vacuumStartCleaning(v);
await wyze.vacuumPauseCleaning(v);
await wyze.vacuumReturnToDock(v);
await wyze.vacuumCleanRooms(v, [11, 14]);

await wyze.vacuumQuiet(v);     // suction Quiet (1)
await wyze.vacuumStandard(v);  // suction Standard (2)
await wyze.vacuumStrong(v);    // suction Strong (3)
```

| Method | Notes |
|---|---|
| `vacuumStartCleaning(device)` | Start (or resume) a whole-home clean |
| `vacuumPauseCleaning(device)` | Pause an in-progress clean |
| `vacuumReturnToDock(device)` | Send vacuum back to its dock |
| `vacuumCleanRooms(device, ids)` | Clean specific rooms by id (single or array) |
| `vacuumQuiet(device)` / `vacuumStandard(device)` / `vacuumStrong(device)` | Suction level shortcuts |

## Controls — mac/model API

For callers that already have mac/model and prefer the lower-level surface (matches the rest of the codebase):

| Method | Notes |
|---|---|
| `vacuumClean(mac)` | Start/resume |
| `vacuumPause(mac)` | Pause |
| `vacuumDock(mac)` | Send to dock |
| `vacuumStop(mac)` | Stop a return-to-dock currently in progress |
| `vacuumCancel(mac)` | Cancel a "resume after charging" state. Same wire payload as `vacuumStop`; named separately for caller clarity |
| `vacuumSweepRooms(mac, ids)` | Clean rooms |
| `vacuumSetSuctionLevel(mac, model, level)` | Levels: `1` Quiet, `2` Standard, `3` Strong |
| `vacuumControl(mac, type, value, extras?)` | **Escape hatch** — raw `(type, value)` codes plus optional fields like `rooms_id` |
| `setVacuumCurrentMap(mac, mapId)` | Set the active map |

## Pure info accessors (sync)

These take the merged result of `getVacuumInfo()` (or any object containing the same keys) and return parsed values. No network calls — safe to call in tight loops.

| Method | Returns |
|---|---|
| `vacuumGetBattery(info)` | `0`–`100` or `null`. Handles the literal `battary` typo Wyze uses on the wire. |
| `vacuumGetMode(info)` | Mode name (`"CLEANING"`, `"PAUSED"`, `"DOCKED_NOT_COMPLETE"`, …) or `null` |
| `vacuumGetFault(info)` | `null` if no fault, `{code, description}` otherwise |
| `vacuumIsCharging(info)` | `boolean` |
| `vacuumIsCleaning(info)` | `boolean` |
| `vacuumIsDocked(info)` | `boolean` (idle or charging) |

## Lower-level reads

| Method | Notes |
|---|---|
| `getVacuumIotProp(mac, keys?)` | IoT props (live state — battery, mode, etc.). `keys` can be string or string[]. Default keys via `WyzeAPI.VacuumIotPropKeys` |
| `getVacuumDeviceInfo(mac, keys?)` | Device-level settings. Default keys via `WyzeAPI.VacuumDeviceInfoKeys` |
| `getVacuumStatus(mac)` | Heartbeat + event flags |
| `getVacuumCurrentPosition(mac)` | Robot's current map coordinates |
| `getVacuumCurrentMap(mac)` | The active map definition |
| `getVacuumMaps(mac)` | All saved maps |
| `getVacuumSweepRecords(mac, { limit?, since? })` | Cleaning history. `since` can be a `Date` or epoch ms (defaults to now). `limit` defaults to `20`. |

## Suction levels

| Code | Constant | Description |
|---|---|---|
| `1` | `WyzeAPI.VacuumSuctionLevel.QUIET` | Lowest noise |
| `2` | `WyzeAPI.VacuumSuctionLevel.STANDARD` | Default |
| `3` | `WyzeAPI.VacuumSuctionLevel.STRONG` | Maximum suction |

```js
await wyze.vacuumSetSuctionLevel(mac, "JA_RO2", Wyze.VacuumSuctionLevel.STRONG);
// or via device helper:
await wyze.vacuumStrong(vacuum);
```

## Status & mode codes

`WyzeAPI.VacuumStatus` (from heartbeat `vacuum_work_status`):

| Code | Meaning |
|---|---|
| `1` | Standby |
| `2` | Cleaning |
| `3` | Returning to charge |
| `4` | Docked |
| `5` | Mapping |
| `6` | Paused |
| `7` | Error |

`WyzeAPI.VacuumModeCodes` is a many-to-one lookup (one mode like `CLEANING` maps to multiple firmware codes). Use `WyzeAPI.parseVacuumMode(code)` to convert a numeric code to a name.

## Fault codes

`WyzeAPI.VacuumFaultCode` is a `{code: description}` table covering the known faults — e.g. `500` = Lidar sensor blocked, `503` = Dustbin not installed, `514` = Wheels stuck. Use `vacuumGetFault(info)` for the parsed result with description lookup built in.

## Opt-in event tracking

The Wyze app fires an analytics ping to `/plugin/venus/event_tracking` after every control action. **Not required** for controls to work — verified during live testing — but exposed as a public method if you want to be wire-identical to the official client:

```js
await wyze.vacuumEventTracking(
  mac,
  Wyze.VacuumControlType.GLOBAL_SWEEPING,
  Wyze.VacuumControlValue.START,
  [Wyze.VenusDotArg1.Vacuum, Wyze.VenusDotArg2.Whole, Wyze.VenusDotArg3.Start]
);
```

## Example — runnable

The repo ships [example/vacuum.js](../example/vacuum.js):

```bash
cd example
LOCAL_DEV=1 npm run vacuum                    # list + status
LOCAL_DEV=1 npm run vacuum -- clean           # start cleaning
LOCAL_DEV=1 npm run vacuum -- dock            # send to dock
LOCAL_DEV=1 npm run vacuum -- rooms 11,14     # clean specific rooms
LOCAL_DEV=1 npm run vacuum -- suction quiet   # quiet | standard | strong
```

## Notes

- `JA_RO2` is currently the only vacuum model on the Wyze account API.
- The `battery` IoT prop is spelled **`battary`** on the wire (Wyze typo, preserved server-side). `vacuumGetBattery()` hides this; direct `getVacuumIotProp()` callers will see the typo.
- All wire shapes here are sourced from wyze-sdk's reverse-engineering of the Wyze Android app (`com.wyze.sweeprobot.*`). Wyze can change them without notice.
