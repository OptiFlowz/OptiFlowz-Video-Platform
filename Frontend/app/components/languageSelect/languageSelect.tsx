import CustomSelect from "~/components/customSelect/customSelect";
import { LANGUAGE_OPTIONS, type Locale } from "~/i18n";

type LanguageSelectProps = {
  value: Locale;
  onChange: (locale: Locale) => void;
  ariaLabel: string;
  label?: string;
  variant?: "menu" | "mobile" | "settings";
};

function LanguageSelect({
  value,
  onChange,
  ariaLabel,
  label,
  variant = "settings",
}: LanguageSelectProps) {
  const selectedLabel = LANGUAGE_OPTIONS.find((option) => option.value === value)?.label ?? value;

  return (
    <CustomSelect
      value={value}
      options={LANGUAGE_OPTIONS}
      onChange={(nextValue) => onChange(nextValue as Locale)}
      ariaLabel={ariaLabel}
      rootClassName={`customLanguageSelect customLanguageSelect--${variant}`}
      triggerClassName="customLanguageTrigger"
      valueContent={label ? (
        <span className="customLanguageText">
          <strong>{label}</strong>
          <small>{selectedLabel}</small>
        </span>
      ) : undefined}
    />
  );
}

export default LanguageSelect;

