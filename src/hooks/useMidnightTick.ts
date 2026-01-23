import { useState, useEffect } from 'react';

export const useMidnightTick = () => {
  // Initialize with local safe date
  const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString('en-CA'));

  useEffect(() => {
    const checkDate = () => {
      const nowStr = new Date().toLocaleDateString('en-CA');
      if (nowStr !== currentDate) {
        console.log("Midnight Tick: Date changed to", nowStr);
        setCurrentDate(nowStr);
      }
    };

    // Check every 30 seconds to be closer to 00:00 without heavy load
    const timer = setInterval(checkDate, 30000);
    
    return () => clearInterval(timer);
  }, [currentDate]);

  return currentDate;
};
