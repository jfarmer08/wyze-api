# API Reference

Module-level exports on `require("wyze-api")`. The default export is the `WyzeAPI` class itself; everything else is attached as a static property.

```js
const Wyze = require("wyze-api");

const wyze = new Wyze(options);   // class
console.log(Wyze.StreamStatus);   // static
```

## Camera streaming

### `WyzeAPI.StreamStatus`

Lifecycle constants for camera streams. Numeric values mirror [docker-wyze-bridge](https://github.com/mrlt8/docker-wyze-bridge)'s `StreamStatus` for cross-ecosystem use.

```js
{
  OFFLINE:    -90,
  STOPPING:    -1,
  DISABLED:     0,
  STOPPED:      1,
  CONNECTING:   2,
  CONNECTED:    3,
}
```

## Robot Vacuum (Venus service)

### `WyzeAPI.VacuumControlType`

```js
{ GLOBAL_SWEEPING: 0, RETURN_TO_CHARGING: 3, AREA_CLEAN: 6, QUICK_MAPPING: 7 }
```

### `WyzeAPI.VacuumControlValue`

```js
{ STOP: 0, START: 1, PAUSE: 2, FALSE_PAUSE: 3 }
```

### `WyzeAPI.VacuumStatus`

```js
{ STANDBY: 1, CLEANING: 2, RETURNING_TO_CHARGE: 3, DOCKED: 4, MAPPING: 5, PAUSED: 6, ERROR: 7 }
```

### `WyzeAPI.VacuumSuctionLevel`

```js
{ QUIET: 1, STANDARD: 2, STRONG: 3 }
```

### `WyzeAPI.VacuumPreferenceType`

```js
{ SUCTION: 1 }
```

### `WyzeAPI.VacuumModeCodes`

Many-to-one mapping. One mode name maps to a list of firmware codes (variants across hardware revisions and modes).

```js
{
  IDLE:                                    [0, 14, 29, 35, 40],
  CLEANING:                                [1, 30, 1101, 1201, 1301, 1401],
  PAUSED:                                  [4, 31, 1102, 1202, 1302, 1402],
  RETURNING_TO_CHARGE:                     [5],
  PAUSE:                                   [9, 27, 37],
  FINISHED_RETURNING_TO_CHARGE:            [10, 32, 1103, 1203, 1303, 1403],
  DOCKED_NOT_COMPLETE:                     [11, 33, 1104, 1204, 1304, 1404],
  FULL_FINISH_SWEEPING_ON_WAY_CHARGE:      [12, 26, 38],
  SWEEPING:                                [7, 25, 36],
  BREAK_POINT:                             [39],
  QUICK_MAPPING_MAPPING:                   [45],
  QUICK_MAPPING_PAUSED:                    [46],
  QUICK_MAPPING_COMPLETED_RETURNING_TO_CHARGE: [47],
  QUICK_MAPPING_DOCKED_NOT_COMPLETE:       [48],
}
```

### `WyzeAPI.parseVacuumMode(code)`

Reverse lookup over `VacuumModeCodes`. Returns the mode name string or `null`.

```js
Wyze.parseVacuumMode(1);    // "CLEANING"
Wyze.parseVacuumMode(1101); // "CLEANING"
Wyze.parseVacuumMode(99);   // null
```

### `WyzeAPI.VacuumFaultCode`

`{numericCode: "human description"}` table. Use `vacuumGetFault(info)` for the parsed `{code, description}` shape.

### `WyzeAPI.VacuumIotPropKeys`

Default key list for `getVacuumIotProp(mac)` and the iot-prop step of `getVacuumInfo(mac)`. Includes the literal Wyze typo `"battary"`.

### `WyzeAPI.VacuumDeviceInfoKeys`

Default key list for `getVacuumDeviceInfo(mac)` — `["mac", "ipaddr", "device_type", "mcu_sys_version"]`.

### `WyzeAPI.VenusDotArg1` / `VenusDotArg2` / `VenusDotArg3`

String enums used by `vacuumEventTracking()` for the `arg1`..`arg3` fields. Match wyze-sdk's `VenusDotArg*Message` classes.

```js
VenusDotArg1: { Vacuum: "Vacuum" }
VenusDotArg2: {
  Whole: "Whole", Spot: "Spot", SelectRooms: "SelectRooms",
  ManualRecharge: "ManualRecharge", FinishRecharge: "FinishRecharge",
  BreakCharging: "BreakCharging", BreakRecharge: "BreakRecharge",
}
VenusDotArg3: { Start: "Start", Resume: "Resume", Pause: "Pause", FalsePause: "FalsePause" }
```

### `WyzeAPI.VacuumControlTypeDescription`

`{code: "human-readable name"}` mapping used as `eventKey` in event-tracking payloads.

```js
{ 0: "Clean", 3: "Recharge", 6: "Area Clean", 7: "Quick Mapping" }
```

## `src/types.js` exports

If you import from `wyze-api/src/types` directly:

```js
const types = require("wyze-api/src/types");
```

You get the same vacuum constants above plus the legacy mapping tables this codebase uses (mostly for HomeKit integrations):

| Export | Notes |
|---|---|
| `propertyIds` | `{NOTIFICATION: "P1", ON: "P3", BRIGHTNESS: "P1501", ...}` |
| `wyzeWallSwitch` | `{CLASSIC: 1, IOT: 2}` |
| `wyzeColorProperty` | `{WYZE_COLOR_TEMP_MIN: 2700, WYZE_COLOR_TEMP_MAX: 6500}` |
| `homeKitColorProperty` | `{HOMEKIT_COLOR_TEMP_MIN: 500, HOMEKIT_COLOR_TEMP_MAX: 140}` |
| `wyze2HomekitUnits` | `{C: 0, F: 1}` |
| `wyze2HomekitStates` | `{off: 0, heat: 1, cool: 2, auto: 3}` |
| `wyze2HomekitWorkingStates` | `{idle: 0, heating: 1, cooling: 2}` |

## Method index

For a complete method list grouped by family, see the family pages:

- [Cameras — Controls](Cameras.md), [Streaming](Camera-Streaming.md), [Snapshot Capture](Snapshot-Capture.md)
- [Plugs](Plugs.md), [Lights & Bulbs](Lights-and-Bulbs.md), [Wall Switches](Wall-Switches.md)
- [Locks](Locks.md), [Thermostat](Thermostat.md), [Irrigation](Irrigation.md), [HMS](HMS.md)
- [Robot Vacuum](Robot-Vacuum.md)
- [Helpers](Helpers.md), [Device Lookup](Device-Lookup.md)
