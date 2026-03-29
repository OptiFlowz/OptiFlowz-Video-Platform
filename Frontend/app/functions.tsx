import { Fragment } from "react";
import type { ReactNode } from "react";
import { getCurrentLocale, translate } from "./i18n";

function getIntlLocale(locale: string): string {
    if (locale === "sr") return "sr-Latn-RS";
    return locale;
}

export function formatDate(date: string): string{
    const locale = getIntlLocale(getCurrentLocale());
    return new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(date));
}

export function formatViews(views: number): string{
    const locale = getIntlLocale(getCurrentLocale());
    if(!views) return translate("pluralViews", { count: 0 });
    if(views === 1) return translate("oneView");

    if(views >= 1000)
        return translate("viewsLabel", {
          count: new Intl.NumberFormat(locale, {
            notation: "compact",
            maximumFractionDigits: 1,
          }).format(views)
        });

    return translate("pluralViews", { count: new Intl.NumberFormat(locale).format(views) });
}

export function formatDuration(duration: number): string{
    let seconds = (duration % 60).toString().padStart(2, '0');
    let minutes = Math.floor(duration / 60).toString().padStart(2, '0');
    let hours: string | undefined = undefined;

    if(duration / (60 * 60) >= 1){
        hours = Math.floor((duration / (60 * 60))).toString();
        minutes = Math.floor(((duration / 60) % 60)).toString().padStart(2, '0');
    }
    
    return (hours ? (hours + ':') : '') + minutes + ':' + seconds;
}

const displayTimeout: {[id: string]: ReturnType<typeof setTimeout>} = {};
export function changeElementClass(props: {element: HTMLElement | null, show?: boolean, timeout?: number}){
    if(!props.element) return;

    const element = props.element;
    
    if(props.show){
        if(displayTimeout[element.id]){
            clearTimeout(displayTimeout[element.id]);
            delete displayTimeout[element.id];
        }

        element.classList.remove("displayNone");

        setTimeout(() => {
            element.classList.add("show");
        }, 10);
    }else{
        element.classList.remove("show");

        displayTimeout[element.id] = setTimeout(() => {
            element.classList.add("displayNone");
            delete displayTimeout[element.id];
        }, props.timeout || 200);
    }
}

export function formatDescription(desc?: string | null): ReactNode[] | null {
  const description = desc ?? "";
  if (!description) return null;

  const parts: ReactNode[] = [];
  let key = 0;

  const lines = description.split("\n");

  const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s);

  const splitTrailingPunctuation = (url: string) => {
    // Skida uobičajenu interpunkciju koja često “zalepi” posle URL-a u tekstu
    // i vraća je nazad kao trailing tekst (da vizuelno ostane isto).
    let trailing = "";
    while (url.length && /[)\].,!?;:}]/.test(url[url.length - 1])) {
      trailing = url[url.length - 1] + trailing;
      url = url.slice(0, -1);
    }
    return { url, trailing };
  };

  const parseLine = (line: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    let lastIndex = 0;

    // Redosled je bitan:
    // 1) [text](url)
    // 2) goli url
    // 3) **bold**
    // 4) *italic*
    // 5) _italic_
    const tokenRegex =
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|https?:\/\/[^\s]+|\*\*([^*]+?)\*\*|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
      const start = match.index;
      const full = match[0];

      if (start > lastIndex) {
        nodes.push(line.slice(lastIndex, start));
      }

      // [Naziv](https://link.com)
      if (match[1] && match[2]) {
        const label = match[1];
        const href = match[2];
        nodes.push(
          <a
            key={`link-${key++}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {label}
          </a>
        );
      }
      // goli URL
      else if (isHttpUrl(full)) {
        const { url, trailing } = splitTrailingPunctuation(full);

        // Ako je sve bilo interpunkcija (retko), fallback na plain text
        if (!url) {
          nodes.push(full);
        } else {
          nodes.push(
            <a
              key={`url-${key++}`}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {url}
            </a>
          );
          if (trailing) nodes.push(trailing);
        }
      }
      // **bold**
      else if (match[3]) {
        nodes.push(<strong key={`bold-${key++}`}>{match[3]}</strong>);
      }
      // *italic*
      else if (match[4]) {
        nodes.push(<em key={`italic-${key++}`}>{match[4]}</em>);
      }
      // _italic_
      else if (match[5]) {
        nodes.push(<em key={`italic2-${key++}`}>{match[5]}</em>);
      }
      // fallback
      else {
        nodes.push(full);
      }

      lastIndex = start + full.length;
    }

    if (lastIndex < line.length) {
      nodes.push(line.slice(lastIndex));
    }

    return nodes;
  };

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) parts.push(<br key={`br-${key++}`} />);
    parts.push(<Fragment key={`line-${lineIndex}`}>{parseLine(line)}</Fragment>);
  });

  return parts;
}

export const getStoredUser = () => {
  const raw = sessionStorage.getItem("user") || localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    localStorage.removeItem("user");
    sessionStorage.removeItem("user");
    return null;
  }
};

export const isUserAdmin = (): boolean => {
  const u = getStoredUser();
  return u?.user?.role === 'admin';
};

export const isUserUEMS = (): boolean => {
  const u = getStoredUser();
  return (u?.user?.role === 'uems' || u?.user?.role === 'admin');
};

export const getToken = (): string | null => {
  const u = getStoredUser();
  return u?.token ?? null;
};

let userImageUrl = "";
export const getUserImageUrl = () => {
  if(userImageUrl == "" && localStorage.user)
    userImageUrl = JSON.parse(sessionStorage.user || localStorage.user).user.image_url;
  return userImageUrl;
}
