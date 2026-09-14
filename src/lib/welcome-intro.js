(() => {
  const intro = document.getElementById("welcome-intro");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");

  if (!(intro instanceof HTMLDialogElement) || motion.matches) {
    return;
  }

  try {
    if (sessionStorage.getItem("kashaf:intro-seen")) {
      return;
    }
    sessionStorage.setItem("kashaf:intro-seen", "1");
  } catch {
    return;
  }

  intro.showModal();
  const finish = () => intro.open && intro.close();
  const timer = setTimeout(finish, 3200);

  intro.querySelector("button")?.addEventListener("click", finish);
  intro.addEventListener(
    "close",
    () => {
      clearTimeout(timer);
      motion.removeEventListener("change", finish);
      removeEventListener("pagehide", finish);
    },
    { once: true }
  );
  motion.addEventListener("change", finish);
  addEventListener("pagehide", finish, { once: true });
})();
