import { useEffect, useState } from "react";

/** Arabic labels for every word Vidstack's audio layout can surface. */
export const PLAYER_TRANSLATIONS = {
  Accessibility: "إمكانية الوصول",
  Announcements: "الإعلانات الصوتية",
  Audio: "الصوت",
  Auto: "تلقائي",
  Boost: "تعزيز",
  "Caption Styles": "أنماط الترجمة",
  Captions: "الترجمة",
  Chapters: "الفصول",
  "Closed-Captions Off": "الترجمة معطّلة",
  "Closed-Captions On": "الترجمة مفعّلة",
  Color: "اللون",
  Continue: "متابعة",
  Default: "الافتراضي",
  Disabled: "معطّل",
  "Display Background": "خلفية العرض",
  Download: "تنزيل",
  Family: "الخط",
  Font: "الخط",
  "Keyboard Animations": "حركات الاختصارات",
  Loop: "تكرار",
  Mute: "كتم الصوت",
  Normal: "عادية",
  Off: "معطّل",
  Opacity: "الشفافية",
  Pause: "إيقاف مؤقّت",
  Play: "تشغيل",
  Playback: "التشغيل",
  Quality: "الجودة",
  Replay: "إعادة",
  Reset: "إعادة الضبط",
  Seek: "تقديم أو تأخير",
  "Seek Backward": "إرجاع",
  "Seek Forward": "تقديم",
  Settings: "الإعدادات",
  Shadow: "الظل",
  Size: "الحجم",
  Speed: "السرعة",
  Text: "النص",
  "Text Background": "خلفية النص",
  Track: "المسار",
  Unmute: "إلغاء الكتم",
  Volume: "مستوى الصوت",
};

export const PLAYER_SPEEDS = { max: 3, min: 0.5, step: 0.25 };
export const PLAYER_SLOTS = { captionButton: null, title: null };

/** Keep Vidstack aligned with the site's class-based theme toggle. */
export const usePlayerTheme = (): "dark" | "light" => {
  const [dark, setDark] = useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setDark(root.classList.contains("dark"))
    );

    observer.observe(root, { attributeFilter: ["class"], attributes: true });

    return () => observer.disconnect();
  }, []);

  return dark ? "dark" : "light";
};
