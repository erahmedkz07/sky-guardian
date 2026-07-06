import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { ru } from "./translations";

export type Lang = "en" | "ru";

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (s: string) => string;
}

const Ctx = createContext<I18nCtx>({ lang: "en", setLang: () => {}, t: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru");

  // Hydrate from localStorage after mount (SSR-safe)
  useEffect(() => {
    const stored = localStorage.getItem("dds_lang");
    if (stored === "ru" || stored === "en") setLangState(stored);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("dds_lang", l);
  };

  const t = (s: string): string => (lang === "en" ? s : (ru[s] ?? s));

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
