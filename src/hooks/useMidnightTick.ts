import { useState, useEffect } from 'react';
import { formatDateInTimeZone } from '../utils/timezone';

export const useMidnightTick = (timeZone?: string | null) => {
  const getCurrentDate = () => formatDateInTimeZone(new Date(), timeZone) || new Date().toLocaleDateString('en-CA');
  const [currentDate, setCurrentDate] = useState(getCurrentDate);

  useEffect(() => {
    const checkDate = () => {
      const nowStr = getCurrentDate();
      if (nowStr !== currentDate) {
        console.log("Midnight Tick: Date changed to", nowStr);
        setCurrentDate(nowStr);
      }
    };

    // Check every 30 seconds to be closer to 00:00 without heavy load
    const timer = setInterval(checkDate, 30000);
    
    return () => clearInterval(timer);
  }, [currentDate, timeZone]);

  return currentDate;
};
