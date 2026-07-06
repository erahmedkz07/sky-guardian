import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { ru } from "date-fns/locale";
import { useT } from "@/lib/i18n";

export function RelativeTime({
  date,
  addSuffix = true,
  className,
}: {
  date: Date | string | number;
  addSuffix?: boolean;
  className?: string;
}) {
  const { lang } = useT();
  const [text, setText] = useState<string>("—");

  useEffect(() => {
    const d = date instanceof Date ? date : new Date(date);
    const locale = lang === "ru" ? ru : undefined;
    const update = () => setText(formatDistanceToNowStrict(d, { addSuffix, locale }));
    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [date, addSuffix, lang]);

  return <span className={className}>{text}</span>;
}
