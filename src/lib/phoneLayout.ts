const iPhone = /iPhone|iPod/i.test(navigator.userAgent);
export const phoneLayout = iPhone || window.matchMedia('(max-width: 700px) and (pointer: coarse)').matches;
