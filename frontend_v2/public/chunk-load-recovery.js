(function () {
  var FLAG = "__tbp_chunk_recovery_once__";

  function recoverOnce() {
    try {
      if (window[FLAG]) return;
      window[FLAG] = true;
      window.location.reload();
    } catch (e) {}
  }

  window.addEventListener(
    "error",
    function (event) {
      var msg = String((event && event.message) || "");
      var target = event && event.target;
      var src = target && target.src ? String(target.src) : "";
      if (msg.toLowerCase().indexOf("loading chunk") !== -1 || msg.toLowerCase().indexOf("chunkloaderror") !== -1) {
        recoverOnce();
        return;
      }
      if (src.indexOf("/_next/static/chunks/") !== -1) {
        recoverOnce();
      }
    },
    true
  );

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var msg = typeof reason === "string" ? reason : String((reason && reason.message) || reason || "");
    var lower = msg.toLowerCase();
    if (lower.indexOf("loading chunk") !== -1 || lower.indexOf("chunkloaderror") !== -1) {
      recoverOnce();
    }
  });
})();
