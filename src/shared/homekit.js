/**
 * Wyze ↔ HomeKit value converters. Mixed onto WyzeAPI prototype so the
 * homebridge-wyze-smart-home plugin can call them as `client.xxx()`.
 *
 * All functions are pure — no network calls, no this-dependence.
 */

// Wyze color temperature range (Kelvin)
const WYZE_COLOR_TEMP_MIN = 2700;
const WYZE_COLOR_TEMP_MAX = 6500;

// HomeKit ColorTemperature characteristic range (mireds).
// Note: higher mireds = warmer, lower = cooler — the opposite of Kelvin.
const HOMEKIT_COLOR_TEMP_MIN = 140; // coolest (~6500 K)
const HOMEKIT_COLOR_TEMP_MAX = 500; // warmest (~2700 K)

module.exports = {
  // ---- Color temperature --------------------------------------------------

  /**
   * Wyze Kelvin (2700–6500) → HomeKit mireds (140–500).
   * Uses the physical 1,000,000/K formula — consistent with `kelvinToMired`.
   */
  wyzeColorTempToHomeKit(kelvin) {
    return Math.round(1_000_000 / kelvin);
  },

  /**
   * HomeKit mireds (140–500) → Wyze Kelvin (2700–6500).
   * Linear range map so the full Wyze palette fits the full HomeKit range.
   */
  homeKitColorTempToWyze(mireds) {
    const t = (mireds - HOMEKIT_COLOR_TEMP_MAX) / (HOMEKIT_COLOR_TEMP_MIN - HOMEKIT_COLOR_TEMP_MAX);
    return Math.round(WYZE_COLOR_TEMP_MIN + t * (WYZE_COLOR_TEMP_MAX - WYZE_COLOR_TEMP_MIN));
  },

  // ---- Lock ---------------------------------------------------------------

  /**
   * Wyze `hardlock` → HomeKit LockCurrentState / LockTargetState.
   * hardlock 2 = unlocked → 0 (UNSECURED), anything else → 1 (SECURED).
   * Alias of `getLockState` with a HomeKit-oriented name.
   */
  wyzeLockStateToHomeKit(hardlock) {
    return hardlock === 2 ? 0 : 1;
  },

  /**
   * Wyze `door_open_status` → HomeKit ContactSensorState.
   * door_open_status 1 (open) → 1 (CONTACT_NOT_DETECTED).
   * door_open_status 0 (closed) → 0 (CONTACT_DETECTED).
   */
  wyzeContactStateToHomeKit(doorOpenStatus) {
    return doorOpenStatus === 1 ? 1 : 0;
  },

  // ---- Thermostat ---------------------------------------------------------

  /**
   * Wyze `mode_sys` string → HomeKit TargetHeatingCoolingState integer.
   *   off → 0, heat → 1, cool → 2, auto → 3
   */
  wyzeThermostatModeToHomeKit(modeSys) {
    return { off: 0, heat: 1, cool: 2, auto: 3 }[modeSys] ?? 0;
  },

  /**
   * HomeKit TargetHeatingCoolingState integer → Wyze `mode_sys` string.
   *   0 → "off", 1 → "heat", 2 → "cool", 3 → "auto"
   */
  homeKitThermostatModeToWyze(value) {
    return ["off", "heat", "cool", "auto"][value] ?? "off";
  },

  /**
   * Wyze `working_state` string → HomeKit CurrentHeatingCoolingState integer.
   *   idle → 0, heating → 1, cooling → 2
   */
  wyzeThermostatWorkingStateToHomeKit(workingState) {
    return { idle: 0, heating: 1, cooling: 2 }[workingState] ?? 0;
  },

  /**
   * Wyze `temp_unit` string → HomeKit TemperatureDisplayUnits integer.
   *   "C" → 0 (CELSIUS), "F" → 1 (FAHRENHEIT)
   */
  wyzeTempUnitToHomeKit(unit) {
    return unit === "F" ? 1 : 0;
  },

  // ---- Generic temperature math ------------------------------------------

  /**
   * Fahrenheit → Celsius. Pure passthrough — preserves precision.
   * Use `wyzeTemperatureToHomeKit` instead when you also want HomeKit's
   * one-decimal rounding.
   */
  fahrenheitToCelsius(f) {
    return (f - 32) / 1.8;
  },

  /**
   * Celsius → Fahrenheit.
   */
  celsiusToFahrenheit(c) {
    return c * 1.8 + 32;
  },

  // ---- Garage door --------------------------------------------------------

  /**
   * Wyze garage-door P1301 value → HomeKit CurrentDoorState / TargetDoorState.
   *   1 (open) → 0 (OPEN), anything else → 1 (CLOSED)
   * HomeKit's CurrentDoorState also has OPENING (2) and CLOSING (3) but
   * Wyze doesn't report transition states.
   */
  wyzeGarageDoorStateToHomeKit(value) {
    return value == 1 ? 0 : 1;
  },

  // ---- Vacuum -------------------------------------------------------------

  /**
   * Wyze vacuum suction level (1=quiet / 2=standard / 3=strong) → HomeKit
   * RotationSpeed percentage (0–100). Rounds to clean third-of-100 buckets
   * so the HomeKit slider lands on visually-pleasing positions.
   *   1 → 33, 2 → 67, 3 → 100, anything else → 0.
   */
  wyzeVacuumSuctionToHomeKit(level) {
    switch (level) {
      case 1: return 33;
      case 2: return 67;
      case 3: return 100;
      default: return 0;
    }
  },

  /**
   * HomeKit RotationSpeed (0–100) → Wyze vacuum suction level (1–3).
   * Splits the 0–100 range into three equal thirds. Speed 0 maps to 1
   * (we don't expose "off via suction"; off goes through the Active
   * characteristic instead).
   */
  homeKitRotationSpeedToWyzeSuction(speed) {
    if (speed <= 33) return 1;
    if (speed <= 66) return 2;
    return 3;
  },

  /**
   * Wyze vacuum mode-name string → boolean "is currently cleaning".
   * The fan-service Active characteristic flips when this is true.
   */
  wyzeVacuumModeIsCleaning(modeName) {
    return modeName === "CLEANING" || modeName === "MAPPING";
  },

  // ---- Color (HEX ↔ HSV) --------------------------------------------------

  /**
   * Wyze HEX color string → HomeKit Hue + Saturation.
   * Wyze stores color as a 6-char hex RGB (e.g. "FF5733").
   * HomeKit uses Hue (0–360°) and Saturation (0–100%).
   *
   * @param {string} hex — 6-char hex string, no leading #
   * @returns {{ hue: number, saturation: number }}
   */
  wyzeColorToHomeKit(hex) {
    // Wyze occasionally returns null / undefined / a short string for
    // PID_COLOR (mesh bulbs returning "" while transitioning, firmware
    // tantrums, etc.). Without this guard the unwrap below throws and
    // takes down the plugin's child process — we've seen this present
    // as a crash loop because homebridge restarts and the next refresh
    // immediately re-triggers the same bad value.
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{6}$/.test(hex)) {
      return { hue: 0, saturation: 0 };
    }
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let hue = 0;
    if (delta !== 0) {
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = Math.round(hue * 60);
      if (hue < 0) hue += 360;
    }

    const saturation = max === 0 ? 0 : Math.round((delta / max) * 100);
    return { hue, saturation };
  },

  /**
   * HomeKit Hue (0–360°) + Saturation (0–100%) → Wyze HEX color string.
   * Value (brightness) is always set to 100 — brightness is a separate
   * HomeKit characteristic controlled by `setBrightness`.
   *
   * @param {number} hue — 0–360
   * @param {number} saturation — 0–100
   * @returns {string} — 6-char uppercase hex, no leading #
   */
  homeKitColorToWyze(hue, saturation) {
    const s = saturation / 100;
    const c = s; // value fixed at 1
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = 1 - c;

    let r = 0, g = 0, b = 0;
    if (hue < 60)       { r = c; g = x; b = 0; }
    else if (hue < 120) { r = x; g = c; b = 0; }
    else if (hue < 180) { r = 0; g = c; b = x; }
    else if (hue < 240) { r = 0; g = x; b = c; }
    else if (hue < 300) { r = x; g = 0; b = c; }
    else                { r = c; g = 0; b = x; }

    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, "0").toUpperCase();
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  },

  // ---- Leak sensor --------------------------------------------------------

  /**
   * Wyze `ws_detect_state` → HomeKit LeakDetected characteristic.
   * Values ≥ 2 indicate a leak (LEAK_DETECTED = 1); 0 or 1 = NO_LEAK (0).
   */
  wyzeLeakStateToHomeKit(state) {
    return state >= 2 ? 1 : 0;
  },

  // ---- Temperature --------------------------------------------------------

  /**
   * Wyze temperature (°F, as reported by th_sensor_temperature) → HomeKit °C.
   * HomeKit always uses Celsius for the CurrentTemperature characteristic.
   */
  wyzeTemperatureToHomeKit(fahrenheit) {
    return Math.round(((fahrenheit - 32) / 1.8) * 10) / 10;
  },

  /**
   * Wyze Thermostat Room Sensor (CO_TH1) reports temperature in tenths of °F
   * (e.g. 712 = 71.2°F). Convert directly to HomeKit °C.
   */
  wyzeRoomSensorTemperatureToHomeKit(tenthsFahrenheit) {
    if (typeof tenthsFahrenheit !== "number") return null;
    const fahrenheit = tenthsFahrenheit / 10;
    return Math.round(((fahrenheit - 32) / 1.8) * 10) / 10;
  },

  /**
   * Wyze Room Sensor battery enum → HomeKit BatteryLevel percentage.
   *   1 EMPTY → 5, 2 LOW → 25, 3 HALF → 60, 4 FULL → 100, anything else → null.
   * Returning null lets callers skip pushing a misleading default to HomeKit.
   */
  wyzeRoomSensorBatteryToHomeKit(level) {
    switch (level) {
      case 1: return 5;   // EMPTY
      case 2: return 25;  // LOW
      case 3: return 60;  // HALF
      case 4: return 100; // FULL
      default: return null;
    }
  },

  /**
   * Wyze Room Sensor battery enum → HomeKit StatusLowBattery (0 or 1).
   * Uses the enum directly (1 EMPTY or 2 LOW → low) rather than the
   * configurable lowBatteryPercentage, because the enum is the device's
   * own qualitative judgment — overriding it with a voltage threshold
   * doesn't make sense for a 4-level reading.
   */
  wyzeRoomSensorBatteryIsLow(level) {
    return level === 1 || level === 2 ? 1 : 0;
  },

  // ---- HMS (Home Monitoring System) --------------------------------------
  //
  // HomeKit SecuritySystemTargetState:
  //   STAY_ARM = 0, AWAY_ARM = 1, NIGHT_ARM = 2, DISARM = 3
  // HomeKit SecuritySystemCurrentState:
  //   STAY_ARM = 0, AWAY_ARM = 1, NIGHT_ARM = 2, DISARMED = 3, ALARM_TRIGGERED = 4
  // Wyze HMS modes (strings): "home" / "away" / "disarm" / "changing" / "off"

  /**
   * Wyze HMS mode string → HomeKit SecuritySystemTargetState (0–3).
   * Unknown / "changing" / "disarm" all collapse to DISARM (3) so HomeKit
   * never gets a numeric value it doesn't understand. "Changing" means a
   * mode transition is in progress — DISARM is the safest interim display.
   */
  wyzeHmsStateToHomeKit(hmsState) {
    switch (hmsState) {
      case "home":     return 0; // STAY_ARM
      case "away":     return 1; // AWAY_ARM
      case "disarm":
      case "changing":
      case "off":
      default:         return 3; // DISARM
    }
  },

  /**
   * HomeKit SecuritySystemTargetState (0–3) → Wyze HMS mode string.
   * NIGHT_ARM (2) collapses to "home" since Wyze HMS doesn't have a
   * separate night-arm mode. ALARM_TRIGGERED (4) — sent by HomeKit only
   * when forwarding a fired alarm, not as a user-set target — maps to ""
   * to preserve the original behavior of being a no-op.
   */
  homeKitHmsStateToWyze(homeKitState) {
    switch (homeKitState) {
      case 0: // STAY_ARM
      case 2: // NIGHT_ARM
        return "home";
      case 1: // AWAY_ARM
        return "away";
      case 3: // DISARM
        return "off";
      case 4: // ALARM_TRIGGERED
        return "";
      default:
        return "off";
    }
  },

  // ---- Battery / brightness validators -----------------------------------

  /**
   * Clamp battery to 100 max; null/undefined → 1.
   */
  checkBatteryVoltage(value) {
    if (value >= 100) return 100;
    if (value === undefined || value === null) return 1;
    return value;
  },

  /**
   * 1 if battery is at or below `this.lowBatteryPercentage`, else 0.
   */
  checkLowBattery(batteryVolts) {
    if (this.checkBatteryVoltage(batteryVolts) <= this.lowBatteryPercentage) {
      return 1;
    }
    return 0;
  },

  /**
   * Clamp HomeKit Brightness characteristic to its valid 1–100 range.
   * HomeKit rejects brightness values outside this band; clamp defensively
   * so a misreporting Wyze bulb can't poison the characteristic.
   */
  checkBrightnessValue(value) {
    if (typeof value !== "number" || Number.isNaN(value)) return 1;
    return Math.max(1, Math.min(100, Math.round(value)));
  },

  /**
   * Clamp HomeKit ColorTemperature characteristic to its valid range.
   * HomeKit's ColorTemperature is in mireds (140 = ~7142K coolest,
   * 500 = 2000K warmest). Values outside [140, 500] are rejected; clamp
   * defensively so a Wyze color-temp report just outside the band still
   * lands on the closest valid HomeKit value.
   */
  checkColorTemp(color) {
    if (typeof color !== "number" || Number.isNaN(color)) return HOMEKIT_COLOR_TEMP_MIN;
    return Math.max(HOMEKIT_COLOR_TEMP_MIN, Math.min(HOMEKIT_COLOR_TEMP_MAX, color));
  },

  // ---- Lock / door / leak state aliases -----------------------------------

  /**
   * Wyze `hardlock` → HomeKit LockCurrentState / LockTargetState.
   * Alias of `wyzeLockStateToHomeKit`.
   */
  getLockState(hardlock) {
    return hardlock == 2 ? 0 : 1;
  },

  /**
   * Wyze door state (lock bolt door) → HomeKit ContactSensorState.
   * ≥ 2 → 1 (CONTACT_NOT_DETECTED), else passthrough.
   */
  getLockDoorState(deviceState) {
    return deviceState >= 2 ? 1 : deviceState;
  },

  /**
   * Wyze `ws_detect_state` → HomeKit LeakDetected.
   * Alias of `wyzeLeakStateToHomeKit`.
   */
  getLeakSensorState(deviceState) {
    return deviceState >= 2 ? 1 : deviceState;
  },

  // ---- Color temperature (Kelvin ↔ mireds) alias --------------------------

  /**
   * Wyze Kelvin → HomeKit mireds. Alias of `wyzeColorTempToHomeKit`.
   */
  kelvinToMired(value) {
    return Math.round(1_000_000 / value);
  },

  // ---- Constants ----------------------------------------------------------

  /** HomeKit ColorTemperature min/max (mireds). */
  HOMEKIT_COLOR_TEMP_MIN,
  HOMEKIT_COLOR_TEMP_MAX,

  /** Wyze color temperature min/max (Kelvin). */
  WYZE_COLOR_TEMP_MIN,
  WYZE_COLOR_TEMP_MAX,
};
