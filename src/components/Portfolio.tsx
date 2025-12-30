import React from 'react';
import { Card } from '../components/ui';

// Placeholder images from Unsplash
const IMAGES = [
  'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1544531586-fde5298cdd40?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1549490349-8643362247b5?w=400&h=400&fit=crop',
  'https://images.unsplash.com/photo-1558655146-d09347e0b7a8?w=400&h=400&fit=crop'
];

export const Portfolio: React.FC = () => {
  return (
    <section className="portfolio-section py-6">
       <h3 className="section-title text-xl font-bold mb-4 px-2">Selected Works</h3>
       <div className="grid grid-cols-2 gap-3 px-1">
         {IMAGES.map((src, i) => (
           <Card key={i} className="p-0 overflow-hidden border-0 aspect-square">
             <img src={src} alt={`Work ${i+1}`} className="w-full h-full object-cover" loading="lazy" />
           </Card>
         ))}
       </div>
    </section>
  );
};
