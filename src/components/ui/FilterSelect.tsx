import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import './FilterSelect.css';

const mobileQuery = '(max-width: 767px)';
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(mobileQuery);
  media.addEventListener('change', notify);
  return () => media.removeEventListener('change', notify);
};
const isMobile = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;

type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  className?: string;
};

export function FilterSelect({ label, value, options, onChange, className = '' }: Props) {
  const mobile = useSyncExternalStore(subscribe, isMobile, serverSnapshot);
  if (mobile) return <select className={`filter-select-native ${className}`} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>;
  return <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className={`filter-select-trigger ${className}`} aria-label={label}>
        <Select.Value />
        <Select.Icon><ChevronDown size={16} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="filter-select-menu" position="popper" sideOffset={5} collisionPadding={8}>
          <Select.Viewport>
            {options.map(option => <Select.Item key={option.value} value={option.value} className="filter-select-item">
              <Select.ItemText>{option.label}</Select.ItemText>
              <Select.ItemIndicator><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
            </Select.Item>)}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>;
}
