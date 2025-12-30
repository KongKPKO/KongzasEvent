import React from 'react';
import { Button } from '../components/ui';
import { Instagram, Facebook, Mail } from 'lucide-react';

const XIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </svg>
);

// Custom TikTok Icon since Lucide doesn't have it standard
const TiktokIcon = ({ size = 20 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
  </svg>
);

export const Socials: React.FC = () => {
  const socialLinks = [
    {
      name: 'X',
      icon: <XIcon size={24} />,
      url: 'https://x.com/SKongza',
      color: 'hover:bg-black hover:text-white'
    },
    {
      name: 'Instagram',
      icon: <Instagram size={24} />,
      url: 'https://www.instagram.com/kongkpko/',
      color: 'hover:bg-pink-600 hover:text-white'
    },
    {
      name: 'Facebook',
      icon: <Facebook size={24} />,
      url: 'https://www.facebook.com/kongzas/',
      color: 'hover:bg-blue-600 hover:text-white'
    },
    {
      name: 'Tiktok',
      icon: <TiktokIcon size={24} />,
      url: 'https://www.tiktok.com/@kongzaswithpaimon',
      color: 'hover:bg-black hover:text-white'
    },
    {
      name: 'Email',
      icon: <Mail size={24} />,
      url: 'mailto:konglnwzas@gmail.com',
      color: 'hover:bg-red-500 hover:text-white'
    }
  ];

  const openLink = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="socials-section py-4 text-center bg-gray-50 rounded-2xl mt-0 mb-6">
      <h3 className="section-title text-xl font-bold mb-6">Follow Me</h3>
      <div className="flex flex-wrap justify-center gap-4 px-4">
        {socialLinks.map((social) => (
          <Button
            key={social.name}
            variant="outline"
            className={`rounded-full w-12 h-12 p-0 flex items-center justify-center transition-all duration-300 border-2 ${social.color}`}
            onClick={() => openLink(social.url)}
            title={social.name}
          >
            {social.icon}
          </Button>
        ))}
      </div>
      <div className="mt-4 text-sm text-gray-400">
        Click to connect
      </div>
    </section>
  );
};
