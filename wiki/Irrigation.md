# Irrigation / Sprinkler

Wyze Sprinkler controller. Uses the **olive** signing scheme against `wyze-lockwood-service.wyzecam.com/plugin/irrigation/*`.

## Reading

| Method | Notes |
|---|---|
| `irrigationGetIotProp(mac)` | Live state — zones, IoT state, RSSI, IP, etc. |
| `irrigationGetDeviceInfo(mac)` | Device-level settings — wiring, sensor, schedule enable, notification toggles, weather skip rules |
| `irrigationGetZones(mac)` | List of zones |
| `irrigationGetScheduleRuns(mac, [limit=2])` | Recent schedule run history |

The default key set for `irrigationGetIotProp` (see [src/index.js](../src/index.js)):

```
zone_state, iot_state, iot_state_update_time, app_version,
RSSI, wifi_mac, sn, device_model, ssid, IP
```

The default key set for `irrigationGetDeviceInfo`:

```
wiring, sensor, enable_schedules, notification_enable,
notification_watering_begins, notification_watering_ends,
notification_watering_is_skipped, skip_low_temp, skip_wind,
skip_rain, skip_saturation
```

## Quick run

Run a single zone for `duration` minutes:

```js
const sprinkler = await wyze.getDeviceByName("Sprinkler");
await wyze.irrigationQuickRun(sprinkler.mac, 1, 10); // zone 1, 10 minutes
```

| Method | Notes |
|---|---|
| `irrigationQuickRun(mac, zoneNumber, duration)` | Start a one-off run |

## Stop

```js
await wyze.irrigationStop(sprinkler.mac);
```

Stops any in-progress run (quick run or scheduled).

| Method | Notes |
|---|---|
| `irrigationStop(mac)` | Cancels the running schedule |

## Schedule history

```js
const recent = await wyze.irrigationGetScheduleRuns(sprinkler.mac, 5);
// recent.data.* — last 5 schedule runs
```

`limit` defaults to `2`. Pass higher to look further back.

## Example: water zone 1 for 5 minutes, then check status

```js
const sprinkler = await wyze.getDeviceByName("Sprinkler");

await wyze.irrigationQuickRun(sprinkler.mac, 1, 5);

const props = await wyze.irrigationGetIotProp(sprinkler.mac);
console.log(props.data.props.zone_state); // shows which zone is currently active
```

## Constructor options

No extra options needed. Uses `oliveSigningSecret` and `oliveAppId` (default constants are correct).
