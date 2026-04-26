# Wall Switches

The Wyze Smart Wall Switch (`LD_SS1`) has two control surfaces:

- **Classic** — controls the load directly (the light wired to the switch).
- **IoT** — controls a "smart action" the switch can trigger (e.g. a Wyze bulb). Independent of the load.

Plus an LED indicator and a vacation mode.

## Power (load)

| Method | Notes |
|---|---|
| `wallSwitchPowerOn(mac, model)` | Switch ON |
| `wallSwitchPowerOff(mac, model)` | Switch OFF |
| `wallSwitchPower(mac, model, value)` | Pass `true` / `false` |

Internally writes `switch-power` via `setIotProp`.

## IoT smart action

| Method | Notes |
|---|---|
| `wallSwitchIotOn(mac, model)` | Trigger the smart action |
| `wallSwitchIotOff(mac, model)` | Stop the smart action |
| `wallSwitchIot(mac, model, value)` | Pass `true` / `false` |

Internally writes `switch-iot`.

## LED state

| Method | Notes |
|---|---|
| `wallSwitchLedStateOn(mac, model)` | Indicator LED ON |
| `wallSwitchLedStateOff(mac, model)` | Indicator LED OFF |

Internally writes `led_state`.

## Vacation mode

| Method | Notes |
|---|---|
| `wallSwitchVacationModeOn(mac, model)` | Writes `vacation_mode = 0` |
| `wallSwitchVacationModeOff(mac, model)` | Writes `vacation_mode = 1` |

> Wyze's `vacation_mode` value is inverted vs. what you might expect: `0` = on, `1` = off. The helpers above hide that.

## Mode constants

`src/types.js` exports `wyzeWallSwitch`:

```js
const { wyzeWallSwitch } = require("wyze-api/src/types");
// { CLASSIC: 1, IOT: 2 }
```

If you want to read which mode the switch is currently in, look at the `iot_state` / `switch-mode` properties via `getIotProp(mac)`.

## Example

```js
const sw = await wyze.getDeviceByName("Hallway Switch");
await wyze.wallSwitchPowerOn(sw.mac, sw.product_model);
await wyze.wallSwitchLedStateOff(sw.mac, sw.product_model);
```

## Reading state

```js
const props = await wyze.getIotProp(sw.mac);
// inspect props.data.props for switch-power, switch-iot, led_state, etc.
```

See **[Authentication](Authentication.md)** if `getIotProp` returns 401/403 — that family uses olive signing and needs the access token to be fresh.
