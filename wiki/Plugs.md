# Plugs

Wyze Plug, Plug Outdoor.

## Methods

| Method | Notes |
|---|---|
| `plugTurnOn(mac, model)` | Sets `P3 = "1"` |
| `plugTurnOff(mac, model)` | Sets `P3 = "0"` |
| `plugPower(mac, model, value)` | Set `P3` to a custom value (`1` on, `0` off) |

## Example

```js
const plug = await wyze.getDeviceByName("Coffee Maker");
await wyze.plugTurnOn(plug.mac, plug.product_model);

// later
await wyze.plugTurnOff(plug.mac, plug.product_model);
```

## Iterating plugs

```js
const plugs = await wyze.getDevicesByType("Plug");
for (const plug of plugs) {
  const state = await wyze.getDeviceState(plug); // "on" | "off" | ""
  console.log(`${plug.nickname}: ${state}`);
}
```

## Models

| `product_model` | Device |
|---|---|
| `WLPP1` | Wyze Plug (indoor) |
| `WLPP1CFH` | Wyze Plug (indoor, newer) |
| `WLPPO`, `WLPPO-SUB` | Wyze Plug Outdoor (parent + sub) |

The outdoor plug is two outlets — the parent reports as `WLPPO` and each sub-outlet as `WLPPO-SUB`. Control them like any other plug; the API treats each outlet as its own device with its own `mac`.
