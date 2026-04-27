/**
 * Pure utility methods mixed onto the WyzeAPI prototype.
 *
 * No network, no external state. The only `this`-dependence is
 * `checkLowBattery` reading `this.lowBatteryPercentage` (a constructor
 * option). Safe to call in tight loops.
 */
module.exports = {
  /**
   * Strip the model prefix from a mac (e.g. "YD.LO1.ABCDEF" → "ABCDEF").
   */
  getUuid(deviceMac, deviceModel) {
    return deviceMac.replace(`${deviceModel}.`, "");
  },

  /**
   * Lock door state: ≥ 2 → 1, else passthrough.
   */
  getLockDoorState(deviceState) {
    if (deviceState >= 2) return 1;
    return deviceState;
  },

  /**
   * Leak sensor state: ≥ 2 → 1, else passthrough.
   */
  getLeakSensorState(deviceState) {
    if (deviceState >= 2) return 1;
    return deviceState;
  },

  /**
   * Lock state: 2 → 0 (unlocked), else 1 (locked).
   */
  getLockState(deviceState) {
    if (deviceState == 2) return 0;
    return 1;
  },

  /**
   * Clamp battery to 100 max; null/undefined → 1.
   */
  checkBatteryVoltage(value) {
    if (value >= 100) return 100;
    if (value === undefined || value === null) return 1;
    return value;
  },

  /**
   * 1 if at or below `lowBatteryPercentage`, else 0.
   */
  checkLowBattery(batteryVolts) {
    if (this.checkBatteryVoltage(batteryVolts) <= this.lowBatteryPercentage) {
      return 1;
    }
    return 0;
  },

  rangeToFloat(value, min, max) {
    return (value - min) / (max - min);
  },

  floatToRange(value, min, max) {
    return Math.round(value * (max - min) + min);
  },

  kelvinToMired(value) {
    return Math.round(1_000_000 / value);
  },

  /**
   * Currently passthrough; intended to clamp 1–100.
   */
  checkBrightnessValue(value) {
    if (value >= 1 && value <= 100) return value;
    return value;
  },

  /**
   * Floor color temperature at 500.
   */
  checkColorTemp(color) {
    if (color >= 500) return color;
    return 500;
  },

  fahrenheit2celsius(fahrenheit) {
    return (fahrenheit - 32.0) / 1.8;
  },

  celsius2fahrenheit(celsius) {
    return celsius * 1.8 + 32.0;
  },

  clamp(number, min, max) {
    return Math.max(min, Math.min(number, max));
  },

  sleepSeconds(seconds) {
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  },

  async sleepMilliSecounds(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
