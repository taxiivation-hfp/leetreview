import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, getSettings, onSettingsChange, type Settings } from './settings';

export function useSettings(): Settings {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    getSettings().then((v) => alive && setS(v));
    const off = onSettingsChange(setS);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return s;
}
