const RECHARTS_SSR_MESSAGE =
  "The width(-1) and height(-1) of chart should be greater than 0";

let installed = false;

function isFilteredRechartsMessage(message: unknown) {
  return typeof message === "string" && message.includes(RECHARTS_SSR_MESSAGE);
}

export function installServerConsoleFilters() {
  if (installed || typeof window !== "undefined") {
    return;
  }

  const originalWarn = console.warn;
  const originalError = console.error;

  console.warn = (...args: unknown[]) => {
    if (isFilteredRechartsMessage(args[0])) {
      return;
    }
    originalWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    if (isFilteredRechartsMessage(args[0])) {
      return;
    }
    originalError(...args);
  };

  installed = true;
}
