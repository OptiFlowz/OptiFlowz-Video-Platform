import { useEffect } from "react";
import { BRAND_NAME } from "~/changeables";
import { useI18n, type TranslationKey } from "~/i18n";

export function useLocalizedPageTitle(key: TranslationKey) {
  const { t } = useI18n();
  useEffect(() => {
    document.title = `${t(key)} | ${BRAND_NAME}`;
  }, [key, t]);
}
