import React from 'react';
import { Card } from './ui';

interface QRCodeDisplayProps {
  value: string;
  size?: number;
}

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({ value, size = 150 }) => {
  // Using Google Chart API for safe, simple QR generation without extra packages for now.
  // In a full offline PWA, we would use 'react-qr-code' package.
  const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=${size}x${size}&chl=${encodeURIComponent(value)}`;

  return (
    <Card className="inline-block p-4 bg-white">
      <img src={qrUrl} alt="Queue QR Code" width={size} height={size} />
      <div className="text-xs text-center text-gray-400 mt-2 font-mono break-all max-w-[150px]">
        {value}
      </div>
    </Card>
  );
};
