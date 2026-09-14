let timer: ReturnType<typeof setTimeout> | undefined;

export const flash = (message: string): void => {
  const toast = document.querySelector<HTMLElement>("#toast > span");

  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(() => {
    toast.hidden = true;
  }, 2000);
};
