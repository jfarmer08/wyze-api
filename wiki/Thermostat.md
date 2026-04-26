# Thermostat

Wyze Thermostat (`CO_EA1`) and Room Sensor (`CO_TH1`).

The thermostat uses the **olive** signing scheme (separate from the main `api.wyzecam.com` API) and exposes a flat IoT-property surface. Read all the props you care about in one call; write them one at a time.

## Reading

```js
const t = await wyze.getDeviceByName("Hallway Thermostat");
const data = await wyze.thermostatGetIotProp(t.mac);
// data.data.props.{temperature, humidity, mode_sys, heat_sp, cool_sp, fan_mode, ...}
```

By default the call requests this set of keys (see [src/index.js](../src/index.js)):

```
trigger_off_val, emheat, temperature, humidity, time2temp_val,
protect_time, mode_sys, heat_sp, cool_sp, current_scenario,
config_scenario, temp_unit, fan_mode, iot_state, w_city_id,
w_lat, w_lon, working_state, dev_hold, dev_holdtime, asw_hold,
app_version, setup_state, wiring_logic_id, save_comfort_balance,
kid_lock, calibrate_humidity, calibrate_temperature, fancirc_time,
query_schedule
```

| Method | Notes |
|---|---|
| `thermostatGetIotProp(mac)` | Returns the full props blob |

## Writing

```js
await wyze.thermostatSetIotProp(t.mac, t.product_model, "mode_sys", "auto");
await wyze.thermostatSetIotProp(t.mac, t.product_model, "heat_sp", 680); // tenths of °F
await wyze.thermostatSetIotProp(t.mac, t.product_model, "fan_mode", "on");
```

| Method | Notes |
|---|---|
| `thermostatSetIotProp(mac, model, propKey, value)` | Sets a single property |

## Common props

| Key | Type | Notes |
|---|---|---|
| `mode_sys` | string | `"auto"`, `"heat"`, `"cool"`, `"off"` |
| `fan_mode` | string | `"auto"`, `"on"`, `"cycle"` |
| `heat_sp` | number | Heat setpoint in tenths of °F (e.g. `680` = 68.0°F) |
| `cool_sp` | number | Cool setpoint in tenths of °F |
| `temperature` | number | Current temp in tenths of °F |
| `humidity` | number | Current relative humidity (%) |
| `temp_unit` | string | `"F"` or `"C"` |
| `working_state` | string | `"idle"`, `"heating"`, `"cooling"` |
| `dev_hold` | bool/string | Whether the thermostat is on a manual hold |
| `kid_lock` | bool | Child lock toggle |

Setpoints are **tenths of a degree** in `°F` regardless of `temp_unit`. To set 70°F, send `700`.

## HomeKit value mapping (helpers)

If you're building HomeKit integrations, `src/types.js` exports the conversion tables this codebase uses:

```js
const { wyze2HomekitUnits, wyze2HomekitStates, wyze2HomekitWorkingStates } =
  require("wyze-api/src/types");

// wyze2HomekitUnits         { C: 0, F: 1 }
// wyze2HomekitStates        { off: 0, heat: 1, cool: 2, auto: 3 }
// wyze2HomekitWorkingStates { idle: 0, heating: 1, cooling: 2 }
```

Plus `fahrenheit2celsius(°F)` and `celsius2fahrenheit(°C)` on the WyzeAPI instance. See **[Helpers](Helpers.md)**.

## Example: full read + summary

```js
const t = await wyze.getDeviceByName("Hallway Thermostat");
const { data: { props } } = await wyze.thermostatGetIotProp(t.mac);

console.log({
  temp: props.temperature / 10 + "°F",
  humidity: props.humidity + "%",
  mode: props.mode_sys,
  fan: props.fan_mode,
  heatSp: props.heat_sp / 10 + "°F",
  coolSp: props.cool_sp / 10 + "°F",
  doing: props.working_state,
});
```
