import './ToggleSwitch.css';

interface ToggleSwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function ToggleSwitch({ label, description, checked, onChange, disabled = false }: ToggleSwitchProps) {
  return (
    <div className={`toggle-switch-container ${disabled ? 'toggle-switch-disabled' : ''}`}>
      <div className="toggle-info">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <label className={`toggle-switch ${disabled ? 'toggle-switch-disabled' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className={`toggle-slider ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}>
          <span className="toggle-slider-thumb"></span>
        </span>
      </label>
    </div>
  );
}

