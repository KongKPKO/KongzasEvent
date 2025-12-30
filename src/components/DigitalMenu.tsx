// import React, { useState } from 'react';
import { useState, useEffect } from 'react';

import genshinPaimonImg from '../assets/menu/Genshin Paimon.jpg';
import dressFurinaImg from '../assets/menu/Dress Furina.jpg';
import miniFigureImg from '../assets/menu/Mini Figure.jpg';
import luggageTagImg from '../assets/menu/Luggage Tag.jpg';
import yoimiyaControllerImg from '../assets/menu/Yoimiya Controller.jpg';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  description: string;
  image?: string;
}

const SAMPLE_MENU: MenuItem[] = [
  { 
    id: '1', 
    name: 'Genshin Paimon Chibi Plush Doll New Model', 
    price: 800, 
    description: 'ขนาดตัวเมื่อยืนขึ้น 30cm วัสดุ Polycool Fiber 100%.',
    image: genshinPaimonImg
  },
  { 
    id: '2', 
    name: 'Dress Furina Theme', 
    price: 3000, 
    description: 'ชุดเดรสสายเดี่ยว วัสดุ 100% Polycool Fiber.',
    image: dressFurinaImg
  },
  { 
    id: '3', 
    name: 'Mini Figure Wondrous Travels', 
    price: 1600,
    description: 'ตัวละ 1600 บาท ขนาด 11 - 14cm วัสดุ PVC ABS',
    image: miniFigureImg
  },
  { 
    id: '4', 
    name: 'Teyvat Expo Luggage Tag', 
    price: 650, 
    description: 'Luggage tag x1 and collectible card x6',
    image: luggageTagImg
  },
  { 
    id: '5', 
    name: 'Yoimiya Frolicking Flames Game Controller', 
    price: 2800, 
    description: 'Product Contents: Custom controller, custom joystick caps x2, charging dock, water-sound bell charm, data cable, wireless receiver, Material: PC ABS',
    image: yoimiyaControllerImg
  },
];

export const DigitalMenu: React.FC = () => {
  const [cart, setCart] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem('menuCart');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error('Failed to load cart', e);
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('menuCart', JSON.stringify(cart));
    } catch (e) {
      console.error('Failed to save cart', e);
    }
  }, [cart]);



  const addToCart = (id: string) => {
    setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeFromCart = (id: string) => {
    setCart(prev => {
      const copy = { ...prev };
      if (copy[id] > 0) copy[id]--;
      return copy;
    });
  };

  const total = SAMPLE_MENU.reduce((sum, item) => sum + (cart[item.id] || 0) * item.price, 0);
  const totalItems = Object.values(cart).reduce((sum, count) => sum + count, 0);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in-down">
      <div className="text-center mb-12">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-white mb-2">Genshin Impact Menu</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">Explore our exclusive merchandise collection</p>
        
        <div className="inline-block bg-surface-light dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg px-6 py-3 transition-all sticky top-20 z-40 backdrop-blur-md opacity-95">
          <div className="flex items-center space-x-4">
            <div className="flex flex-col text-left">
              <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wider">Total Price</span>
              <span className="text-xl font-bold text-primary">฿{total.toLocaleString()}</span>
            </div>
            <div className="h-8 w-px bg-gray-200 dark:bg-gray-700"></div>
            <div className="flex flex-col text-left">
              <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold tracking-wider">Items</span>
              <span className="text-sm font-medium text-gray-900 dark:text-white">{totalItems} Selected</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
        {SAMPLE_MENU.map(item => {
            const count = cart[item.id] || 0;
            return (
              <div key={item.id} className="group bg-surface-light dark:bg-surface-dark rounded-2xl shadow-sm hover:shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-300 flex flex-col">
                <div className="relative aspect-square w-full overflow-hidden bg-gray-200 dark:bg-gray-800">
                  {item.image ? (
                    <img 
                      alt={item.name} 
                      className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300" 
                      src={item.image} 
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">No Image</div>
                  )}
                </div>
                <div className="p-5 flex flex-col flex-grow">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white line-clamp-2">{item.name}</h3>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 line-clamp-3">{item.description}</p>
                  
                  <div className="mt-auto pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-primary">฿{item.price.toLocaleString()}</span>
                    </div>
                    
                    {count > 0 ? (
                        <div className="flex items-center justify-between bg-background-light dark:bg-black/20 rounded-lg p-1">
                          <button 
                            onClick={() => removeFromCart(item.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-white dark:bg-surface-dark text-secondary hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm transition-colors border border-gray-200 dark:border-gray-600"
                          >
                            <span className="material-icons-round text-sm">remove</span>
                          </button>
                          <span className="font-semibold text-gray-900 dark:text-white mx-2 w-6 text-center">{count}</span>
                          <button 
                            onClick={() => addToCart(item.id)}
                            className="w-8 h-8 flex items-center justify-center rounded-md bg-secondary text-white hover:bg-indigo-600 shadow-sm transition-colors"
                          >
                            <span className="material-icons-round text-sm">add</span>
                          </button>
                        </div>
                    ) : (
                        <button 
                            onClick={() => addToCart(item.id)}
                            className="w-full py-2 px-4 border border-secondary text-secondary hover:bg-secondary hover:text-white rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 group-hover:bg-secondary group-hover:text-white"
                        >
                            <span className="material-icons-round text-sm">add_shopping_cart</span>
                            Add to Cart
                        </button>
                    )}
                  </div>
                </div>
              </div>
            );
        })}
        
        {/* "More Items Coming Soon" Placeholder Card from design */}
        <div className="group bg-surface-light dark:bg-surface-dark rounded-2xl shadow-sm hover:shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden transition-all duration-300 flex flex-col justify-center items-center p-8 min-h-[400px]">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
            <span className="material-icons-round text-3xl">more_horiz</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-500 dark:text-gray-400 text-center">More Items Coming Soon</h3>
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center mt-2 max-w-[200px]">Stay tuned for new merchandise from upcoming events.</p>
        </div>
      </div>
    </div>
  );
};

