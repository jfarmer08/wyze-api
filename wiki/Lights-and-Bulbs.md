# Lights & Bulbs

Wyze Bulb (white), Bulb White v2, Mesh (color) Bulb, Light Strip, Light Strip Pro.

There are **two control surfaces** depending on the model:

- **Direct** (`lightTurnOn` / `setBrightness` / `setColorTemperature`) — used by simple white bulbs (`WLPA19`, `HL_HWB2`).
- **Mesh** (`lightMeshOn` / `setMeshBrightness` / etc.) — used by mesh bulbs and light strips (`WLPA19C`, `HL_LSL`, `HL_LSLP`). These send a `set_mesh_property` action list because the device is reached via the Wyze hub mesh, not directly.

Pick by `product_model` (see the [Models](#models) table below).

## Direct lights

| Method | Notes |
|---|---|
| `lightTurnOn(mac, model)` | `P3 = "1"` |
| `lightTurnOff(mac, model)` | `P3 = "0"` |
| `lightPower(mac, model, value)` | Set `P3` to a custom value |
| `setBrightness(mac, model, value)` | `P1501` — `1`–`100` |
| `setColorTemperature(mac, model, value)` | `P1502` — Kelvin (e.g. `2700`–`6500`) |

```js
const lamp = await wyze.getDeviceByName("Desk Lamp");
await wyze.lightTurnOn(lamp.mac, lamp.product_model);
await wyze.setBrightness(lamp.mac, lamp.product_model, 50);
await wyze.setColorTemperature(lamp.mac, lamp.product_model, 3500);
```

## Mesh bulbs / light strips

| Method | Notes |
|---|---|
| `lightMeshOn(mac, model)` | `P3 = "1"` via `set_mesh_property` |
| `lightMeshOff(mac, model)` | `P3 = "0"` via `set_mesh_property` |
| `lightMeshPower(mac, model, value)` | Set `P3` to a custom value |
| `turnMeshOn(mac, model)` | Older alias of `lightMeshOn` |
| `turnMeshOff(mac, model)` | Older alias of `lightMeshOff` |
| `setMeshBrightness(mac, model, value)` | `P1501` — `1`–`100` |
| `setMeshColorTemperature(mac, model, value)` | `P1502` — Kelvin |
| `setMeshHue(mac, model, value)` | `P1507` — hue (0–360) |
| `setMeshSaturation(mac, model, value)` | `P1507` — saturation (0–100) |

> Note: in the current code `setMeshHue` and `setMeshSaturation` both write to `P1507`. If you need to set them independently, you may need to write your own combined value via `runActionList`.

```js
const strip = await wyze.getDeviceByName("Living Room Strip");
await wyze.lightMeshOn(strip.mac, strip.product_model);
await wyze.setMeshBrightness(strip.mac, strip.product_model, 75);
await wyze.setMeshColorTemperature(strip.mac, strip.product_model, 4000);
```

## Local bulb command (advanced)

`localBulbCommand(mac, model, deviceEnr, deviceIp, propertyId, propertyValue, actionKey)` — send a property write directly to the bulb on the LAN, bypassing the cloud. Encrypted with the device's `enr` value (which you can pull from `getDeviceList()`). Falls back to a cloud `runActionList` if the local request fails.

This is useful for very-low-latency control on the LAN, but most callers should stick with the mesh helpers.

## Models

| `product_model` | Device | Use |
|---|---|---|
| `WLPA19` | Wyze Bulb (white v1) | Direct |
| `HL_HWB2` | Wyze Bulb White (v2) | Direct |
| `WLPA19C` | Wyze Bulb Color (mesh) | Mesh |
| `HL_LSL` | Wyze Light Strip | Mesh |
| `HL_LSLP` | Wyze Light Strip Pro | Mesh |

## Helpers worth knowing

- `kelvinToMired(value)` — convert color temperature for HomeKit (HomeKit uses mired, Wyze uses Kelvin).
- `checkColorTemp(value)` — clamps to a sane minimum.
- `checkBrightnessValue(value)` — passes through `1`–`100`.
- `wyze2HomekitUnits` (in [src/types.js](../src/types.js)) — `{C: 0, F: 1}`.

See **[Helpers](Helpers.md)** for the full list.
