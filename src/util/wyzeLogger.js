"use strict";

/**
 * Tiny leveled logger that produces output formatted like a homebridge
 * line so the wyze-api submodule's log statements blend in with whatever
 * the host plugin already prints, instead of looking like they came from
 * a different program.
 *
 * Format:   [4/27/2026, 11:15:27 PM] [Wyze] [DEBUG] message
 * Level tags are color-coded so debug / info / warn / error are
 * distinguishable at a glance even when printed inline. Falls back to
 * plain text when stdout isn't a TTY (so log files don't get junk
 * escape sequences).
 *
 * Levels — standard syslog ordering, lower number = more severe:
 *   error 0, warn 1, info 2, debug 3
 * The configured `level` is the threshold; calls more verbose than
 * that become true no-ops (no string formatting work).
 *
 * Constructor options:
 *   - level   "error" | "warn" | "info" (default) | "debug"
 *   - prefix  bracket tag at the front of every line (default "Wyze")
 *   - stream  where to write — defaults to process.stdout. Pass
 *             process.stderr or a custom Writable for testing.
 */
const LEVELS = Object.freeze({ error: 0, warn: 1, info: 2, debug: 3 });

const COLORS = {
  reset:   "\x1b[0m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  bold:    "\x1b[1m",
};

const LEVEL_TAGS = {
  error: { label: "ERROR", color: COLORS.red + COLORS.bold },
  warn:  { label: "WARN",  color: COLORS.yellow },
  info:  { label: "INFO",  color: COLORS.green },
  // DEBUG was blue but the cyan prefix clashed — magenta keeps debug
  // visually distinct from prefix, info, warn, and error.
  debug: { label: "DEBUG", color: COLORS.magenta },
};

class WyzeLogger {
  constructor({ level = "info", prefix = "Wyze API", stream, color } = {}) {
    this.setLevel(level);
    this.prefix = prefix;
    this.stream = stream || process.stdout;
    // Colors on by default — homebridge's log pipeline + most modern
    // terminals handle ANSI escape codes fine, and isTTY is false when
    // running under hb-service so a TTY-only check would strip colors
    // exactly when users want them. Honors the de-facto NO_COLOR env
    // var (https://no-color.org/) for users on log viewers that don't
    // strip ANSI. Explicit `color: false` in the constructor wins.
    if (color === false) this.useColor = false;
    else if (color === true) this.useColor = true;
    else this.useColor = !process.env.NO_COLOR;
  }

  setLevel(level) {
    const normalized = String(level).toLowerCase();
    this.level = LEVELS[normalized] != null ? normalized : "info";
    this._minWeight = LEVELS[this.level];
  }

  _shouldLog(level) {
    return LEVELS[level] <= this._minWeight;
  }

  _format(level, args) {
    // Match homebridge's en-US locale timestamp format:
    //   "4/27/2026, 11:15:27 PM"
    const ts = new Date().toLocaleString("en-US", {
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit",
      hour12: true,
    });

    // Stringify each arg the way console.log does for plain strings,
    // and JSON-dump objects.
    const message = args.map((a) => {
      if (a == null) return String(a);
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ");

    const tag = LEVEL_TAGS[level];
    const tagText = `[${tag.label}]`;
    const prefixText = `[${this.prefix}]`;
    if (this.useColor) {
      // Cyan prefix matches homebridge's "[PluginName]" coloring so the
      // line blends in with everything else in the log panel.
      return `[${ts}] ${COLORS.cyan}${prefixText}${COLORS.reset} ${tag.color}${tagText}${COLORS.reset} ${message}\n`;
    }
    return `[${ts}] ${prefixText} ${tagText} ${message}\n`;
  }

  _emit(level, args) {
    if (!this._shouldLog(level)) return;
    try {
      this.stream.write(this._format(level, args));
    } catch {
      // Last-ditch console fallback so a stream error never crashes the host.
      // eslint-disable-next-line no-console
      console.log(this._format(level, args).trimEnd());
    }
  }

  error(...args)   { this._emit("error", args); }
  warn(...args)    { this._emit("warn",  args); }
  warning(...args) { this._emit("warn",  args); } // legacy ptkdev alias
  info(...args)    { this._emit("info",  args); }
  debug(...args)   { this._emit("debug", args); }
}

module.exports = { WyzeLogger, LEVELS };
