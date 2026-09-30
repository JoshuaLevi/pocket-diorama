const CSI = String.fromCharCode(27) + "[";

const COLOR_ENABLED = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function paint(code, text) {
  return COLOR_ENABLED ? CSI + code + "m" + text + CSI + "0m" : text;
}

export const color = {
  dim: (t) => paint("2", t),
  bold: (t) => paint("1", t),
  green: (t) => paint("32", t),
  red: (t) => paint("31", t),
  yellow: (t) => paint("33", t),
  cyan: (t) => paint("36", t),
};

function stamp() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return color.dim(hh + ":" + mm + ":" + ss);
}

export const log = {
  info(message) {
    process.stdout.write(stamp() + " " + message + "\n");
  },
  ok(message) {
    process.stdout.write(stamp() + " " + color.green("ok") + "   " + message + "\n");
  },
  warn(message) {
    process.stdout.write(stamp() + " " + color.yellow("warn") + " " + message + "\n");
  },
  error(message) {
    process.stderr.write(stamp() + " " + color.red("err") + "  " + message + "\n");
  },
  plain(message) {
    process.stdout.write(message + "\n");
  },
};

/** 1048576 -> "1.00 MiB". Used in the terminal banner and in the browser UI. */

export function formatBytes(bytes) {
  if (bytes < 1024)
    return bytes + " B";
  if (bytes < 1024 * 1024)
    return (bytes / 1024).toFixed(1) + " KiB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MiB";
}
