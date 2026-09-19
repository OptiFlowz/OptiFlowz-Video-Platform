import { ActiveSVG, InactiveSVG } from "~/constants";
import { useI18n } from "~/i18n";
import StatusPicker from "~/components/library/statusPicker";

type Props = {
  active: boolean;
  title: string;
  disabled?: boolean;
  onSave: (active: boolean) => Promise<void>;
};

export default function QuizStatusPicker({ active, title, disabled, onSave }: Props) {
  const { t } = useI18n();
  return <StatusPicker
    value={active ? "active" : "inactive"}
    title={title}
    disabled={disabled}
    className={`managementStatus ${active ? "active" : "inactive"}`}
    options={[
      { value: "active", label: t("adminActive"), icon: ActiveSVG },
      { value: "inactive", label: t("adminInactive"), icon: InactiveSVG },
    ]}
    onSave={value => onSave(value === "active")}
  />;
}
