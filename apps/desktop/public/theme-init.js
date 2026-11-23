try {
  var saved = localStorage.getItem("color-scheme");
  if (saved === "light" || saved === "dark") {
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", saved);
  }
} catch (_err) {
  // Ignore storage access errors in restricted environments.
}
