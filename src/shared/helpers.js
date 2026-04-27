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

  rangeToFloat(value, min, max) {
    return (value - min) / (max - min);
  },

  floatToRange(value, min, max) {
    return Math.round(value * (max - min) + min);
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
