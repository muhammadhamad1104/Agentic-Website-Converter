import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordField({ label, value, onChange, current = false, disabled = false }: {
  label: string; value: string; onChange: (value: string) => void; current?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = `${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`;
  return <label htmlFor={id}>{label}<div className="input-wrapper">
    <input id={id} className="input input--with-action" type={visible ? 'text' : 'password'} autoComplete={current ? 'current-password' : 'new-password'}
      value={value} onChange={event => onChange(event.target.value)} required minLength={current ? 1 : 12} maxLength={256} disabled={disabled} />
    <button className="input-action" type="button" onClick={() => setVisible(!visible)} aria-label={action} title={action} disabled={disabled}>
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  </div></label>;
}
