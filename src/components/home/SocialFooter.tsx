
import { Link } from 'react-router-dom';
import { Instagram, Facebook, Music2, Mail, HelpCircle } from 'lucide-react';
import { uiText, useI18n } from '../../i18n';

interface SocialFooterProps {
  artist: {
    x_url?: string;
    ig_url?: string;
    facebook_url?: string;
    tiktok_url?: string;
    email?: string;
  };
}

const XIcon = ({ size = 20, className = "" }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644z" />
  </svg>
);

const SocialFooter = ({ artist }: SocialFooterProps) => {
  const { t, language } = useI18n();
  const socialLinks = [
    { icon: <XIcon size={20} />, url: artist.x_url, label: 'X', hoverClass: 'hover:bg-black' },
    { icon: <Instagram size={20} />, url: artist.ig_url, label: 'Instagram', hoverClass: 'hover:bg-[#d62976]' },
    { icon: <Facebook size={20} />, url: artist.facebook_url, label: 'Facebook', hoverClass: 'hover:bg-[#1877f2]' },
    { icon: <Music2 size={20} />, url: artist.tiktok_url, label: 'TikTok', hoverClass: 'hover:bg-black' },
    { icon: <Mail size={20} />, url: artist.email ? `mailto:${artist.email}` : '', label: uiText(language, 'Email'), hoverClass: 'hover:bg-[#ea4335]' },
  ].filter(link => link.url);

  return (
      <div className="px-8 mt-6">
        {socialLinks.length > 0 && <><div className="flex items-center gap-4 mb-4">
           <div className="h-px bg-gray-200 flex-1"></div>
           <span className="text-xs font-bold text-black uppercase tracking-widest">{t('creatorFollowMe')}</span>
           <div className="h-px bg-gray-200 flex-1"></div>
        </div>
        <div className="mb-4 flex items-center justify-center gap-3">
           {socialLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                aria-label={link.label}
                className="grid h-11 w-11 place-items-center rounded-full border border-pink-100 bg-white text-black shadow-sm transition-all hover:scale-105 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink-100"
              >
                 {link.icon}
              </a>
           ))}
        </div>
        </>}
        <div className="flex items-center justify-center border-t border-pink-100 py-4">
          <Link to="/help" className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold text-gray-600 hover:bg-pink-50 hover:text-pink-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-pink-100">
            <HelpCircle size={18} />
            {(language === 'th' ? 'ช่วยเหลือและแจ้งปัญหา' : 'Help & feedback')}
          </Link>
        </div>
      </div>
  );
};

export default SocialFooter;
