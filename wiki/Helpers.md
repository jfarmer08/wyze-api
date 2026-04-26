# Helpers

Synchronous utility methods on the WyzeAPI instance. All are pure (no network, no logging) — safe to call in tight loops.

## Battery

| Method | Notes |
|---|---|
| `checkBatteryVoltage(value)` | Clamps to `100` max; returns `1` for `null`/`undefined`; otherwise returns the input. |
| `checkLowBattery(volts)` | Returns `1` if at or below `lowBatteryPercentage` (constructor option, default `30`), else `0`. |

```js
const wyze = new Wyze({ /* ... */, lowBatteryPercentage: 20 });
wyze.checkLowBattery(15); // 1
wyze.checkLowBattery(50); // 0
```

## Range conversion

| Method | Notes |
|---|---|
| `rangeToFloat(value, min, max)` | Map any range to `[0, 1]`. |
| `floatToRange(value, min, max)` | Inverse — map `[0, 1]` back to the range, rounded. |

```js
wyze.rangeToFloat(50, 0, 100); // 0.5
wyze.floatToRange(0.25, 0, 100); // 25
```

## Color temperature

| Method | Notes |
|---|---|
| `kelvinToMired(value)` | `Math.round(1_000_000 / kelvin)` — HomeKit color temperature uses mired, Wyze uses Kelvin. |
| `checkColorTemp(value)` | Clamps below `500` to `500`. |
| `checkBrightnessValue(value)` | Currently passthrough; intended to clamp `1`–`100`. |

```js
wyze.kelvinToMired(2700); // 370
wyze.kelvinToMired(6500); // 154
```

## Temperature

| Method | Notes |
|---|---|
| `fahrenheit2celsius(°F)` | `(°F − 32) / 1.8` |
| `celsius2fahrenheit(°C)` | `°C × 1.8 + 32` |

## Lock state

| Method | Notes |
|---|---|
| `getLockState(value)` | `2` → `0` (unlocked), anything else → `1` (locked). |
| `getLockDoorState(value)` | `≥ 2` → `1`, else passthrough. |
| `getLeakSensorState(value)` | `≥ 2` → `1`, else passthrough. |

## Sleep

| Method | Notes |
|---|---|
| `sleepSeconds(seconds)` | Returns a `Promise` resolved after the given seconds. |
| `sleepMilliSecounds(ms)` | Same, in milliseconds. *(Note: typo preserved for backwards compat.)* |

```js
await wyze.sleepSeconds(2);
```

## Misc

| Method | Notes |
|---|---|
| `clamp(n, min, max)` | `Math.max(min, Math.min(n, max))` |
| `getUuid(mac, model)` | Strips `<model>.` prefix from a mac. Used internally for V1 lock control. |
