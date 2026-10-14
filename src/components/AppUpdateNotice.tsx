import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';

export default function AppUpdateNotice() {
  const { language } = useI18n();
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let hadController = Boolean(navigator.serviceWorker.controller);
    let active = true;
    let lastCheck = 0;
    const changed = () => {
      // First installation is not an update to the running page.
      if (hadController) setAvailable(true);
      hadController = true;
    };
    const check = () => {
      if (!navigator.onLine || document.visibilityState !== 'visible' || Date.now() - lastCheck < 60_000) return;
      lastCheck = Date.now();
      void navigator.serviceWorker.getRegistration().then(registration => {
        if (active && registration) return registration.update();
      }).catch(() => {
        console.warn('[App update] Could not check the release; will retry later.');
      });
    };
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    const timer = window.setInterval(check, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, []);
  if (!available) return null;
  return (
    <div role="status" className="fixed right-3 top-3 z-[100] max-w-sm rounded-xl border border-pink-200 bg-white p-3 text-sm text-gray-900 shadow-lg">
      <p className="font-bold">{language === 'th' ? 'มี NireQ เวอร์ชันใหม่' : 'A new NireQ version is available'}</p>
      <p className="mt-1">{language === 'th' ? 'บันทึกงานและทำรายการที่ค้างให้เสร็จก่อนโหลดใหม่' : 'Save your work and finish any pending action before reloading.'}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="min-h-11 rounded-lg bg-pink-600 px-3 font-bold text-white" onClick={() => window.location.reload()}>
          {language === 'th' ? 'โหลดเวอร์ชันใหม่' : 'Load new version'}
        </button>
        <button type="button" className="min-h-11 rounded-lg px-3" onClick={() => setAvailable(false)}>{language === 'th' ? 'ไว้ก่อน' : 'Later'}</button>
      </div>
    </div>
  );
}
