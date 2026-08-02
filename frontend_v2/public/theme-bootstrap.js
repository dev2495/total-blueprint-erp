(() => {
  try {
    const stored = window.localStorage.getItem("tpp-theme");
    const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const theme = stored || (prefersDark ? "dark" : "light");
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    root.classList.toggle("dark", theme === "dark");
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
