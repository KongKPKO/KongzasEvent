import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
// ✅ Import Icons เพิ่มเติมสำหรับแสดงหน้า Event
import { Calendar } from 'lucide-react';

// --- TYPES ---
interface Product {
    id: string;
    name: string;
    price: number;
    image_url: string | null;
    is_out_of_stock: boolean;
    status: string;
    category: string | null;
}
interface CartItem { product: Product; quantity: number; notes?: string; }
interface Queue { id: string; queue_number: string; status: string; }

// Sort Types
type SortType = 'name' | 'price_low' | 'price_high';

export default function ManageOrders() {
    const navigate = useNavigate();
    const location = useLocation();
    const [products, setProducts] = useState<Product[]>([]);
    const [queues, setQueues] = useState<Queue[]>([]);

    // State: Selection & Cart
    const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);
    const [cart, setCart] = useState<CartItem[]>([]);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(null);

    // ✅ State: Active Event Name
    const [activeEventName, setActiveEventName] = useState<string>('');

    // Ref เพื่อกัน Race Condition
    const selectedQueueIdRef = useRef<string | null>(null);

    // State: Search, Filter & Sort
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [sortBy, setSortBy] = useState<SortType>('name');

    // Update Ref
    useEffect(() => {
        selectedQueueIdRef.current = selectedQueueId;
    }, [selectedQueueId]);

    // --- 1. FETCH MASTER DATA ---
    useEffect(() => {
        fetchProducts();
        fetchActiveQueues();
        fetchActiveEvent(); // ✅ เรียกฟังก์ชันดึง Event

        const channel = supabase.channel('pos-master-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, fetchProducts)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'queues' }, fetchActiveQueues)
            // ✅ Subscribe การเปลี่ยนแปลง Events ด้วย
            .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, fetchActiveEvent)
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const fetchProducts = async () => {
        const { data } = await supabase.from('products').select('*').eq('status', 'enable').order('name');
        if (data) setProducts(data);
    };

    const fetchActiveQueues = async () => {
        const { data } = await supabase
            .from('queues')
            .select('*')
            .eq('status', 'serving')
            .order('queue_number');
            
        if (data) setQueues(data);
    };

    // ✅ FUNCTION: ดึง Event ล่าสุดที่ Confirmed
    const fetchActiveEvent = async () => {
        const { data } = await supabase
            .from('events')
            .select('event_name')
            .eq('status', 'Confirmed')
            .order('start_date', { ascending: false }) // เอาใหม่สุด
            .limit(1)
            .maybeSingle();
        
        if (data) {
            setActiveEventName(data.event_name);
        } else {
            setActiveEventName('');
        }
    };

    // --- 2. FETCH ACTIVE ORDER ---
    const fetchCurrentOrder = useCallback(async () => {
        const currentTargetQueueId = selectedQueueIdRef.current;
        
        setLoading(true);
        console.log("🔍 Fetching order for:", currentTargetQueueId ? `Queue ID: ${currentTargetQueueId}` : "Walk-in (Null)");

        try {
            let query = supabase.from('orders')
                .select('id, status, queue_id')
                .neq('status', 'completed'); 

            if (currentTargetQueueId) {
                query = query.eq('queue_id', currentTargetQueueId);
            } else {
                query = query.is('queue_id', null);
            }

            const { data: order, error } = await query
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (selectedQueueIdRef.current !== currentTargetQueueId) return;

            if (error) console.error("❌ Error fetching order:", error);

            if (order) {
                setCurrentOrderId(order.id);
                const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);
                
                if (selectedQueueIdRef.current !== currentTargetQueueId) return;

                if (items && products.length > 0) {
                    const newCart: CartItem[] = items.map(item => {
                        const prod = products.find(p => p.id === item.product_id);
                        return prod ? { product: prod, quantity: item.quantity, notes: item.notes } : null;
                    }).filter(Boolean) as CartItem[];
                    
                    setCart(newCart);
                }
            } else {
                setCurrentOrderId(null);
                setCart([]); 
            }
        } catch (err) {
            console.error("Critical Error:", err);
        } finally {
            if (selectedQueueIdRef.current === currentTargetQueueId) {
                setLoading(false);
            }
        }
    }, [products]);

    // --- 3. REALTIME ---
    useEffect(() => {
        setCart([]);
        setCurrentOrderId(null);
        
        fetchCurrentOrder();

        const channel = supabase.channel('pos-order-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => setTimeout(() => fetchCurrentOrder(), 200))
            .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => setTimeout(() => fetchCurrentOrder(), 200))
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [selectedQueueId, fetchCurrentOrder]); 

    // --- 4. DISPLAY LOGIC ---
    const categories = useMemo(() => {
        const cats = products.map(p => p.category).filter(Boolean) as string[];
        return ['All', ...new Set(cats)];
    }, [products]);

    const filteredProducts = useMemo(() => {
        let result = products.filter(product => {
            const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'All' || product.category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
        return result.sort((a, b) => {
            if (sortBy === 'price_low') return a.price - b.price;
            if (sortBy === 'price_high') return b.price - a.price;
            return a.name.localeCompare(b.name);
        });
    }, [products, searchQuery, selectedCategory, sortBy]);

    // --- 5. HELPERS ---
    const getProductImage = (path: string | null) => {
        if (!path) return '';
        if (path.startsWith('http') || path.startsWith('blob:')) return path; 
        return `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/Menu/${path}`;
    };

    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
            return [...prev, { product, quantity: 1 }];
        });
    };

    const decreaseQuantity = (productId: string) => {
        setCart(prev => prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item).filter(item => item.quantity > 0));
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    };

    const totalPrice = useMemo(() => cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0), [cart]);

    // --- 6. PAYMENT LOGIC ---
    const handlePayment = async (method: 'cash' | 'transfer') => {
        setLoading(true);
        try {
            // ✅ FIX: ใช้ Logic เดียวกันกับ fetchActiveEvent เพื่อความชัวร์
            const { data: events } = await supabase
                .from('events')
                .select('id')
                .eq('status', 'Confirmed')
                .order('start_date', { ascending: false })
                .limit(1);
            
            const event = events?.[0];
            if (!event) throw new Error("No active event found.");

            let orderId = currentOrderId;

            if (!orderId) {
                const { data: order, error: orderError } = await supabase.from('orders').insert({
                    event_id: event.id,
                    queue_id: selectedQueueId, 
                    status: 'completed',
                    total_price: totalPrice,
                    payment_method: method
                }).select().single();
                if (orderError) throw orderError;
                orderId = order.id;
            } else {
                const { error } = await supabase.from('orders').update({ 
                    status: 'completed', 
                    total_price: totalPrice, 
                    payment_method: method 
                }).eq('id', orderId);
                if (error) throw error;
            }

            await supabase.from('order_items').delete().eq('order_id', orderId);
            const itemsToInsert = cart.map(item => ({
                order_id: orderId,
                product_id: item.product.id,
                quantity: item.quantity,
                price_per_unit: item.product.price,
                notes: item.notes || ''
            }));
            if (itemsToInsert.length > 0) {
                await supabase.from('order_items').insert(itemsToInsert);
            }

            if (selectedQueueId) {
                const { error: queueError } = await supabase
                    .from('queues')
                    .update({ status: 'complete' }) 
                    .eq('id', selectedQueueId);
                
                if (queueError) throw queueError;
            }

            alert(`Order Completed! (${method.toUpperCase()})`);
            
            setCart([]); 
            setCurrentOrderId(null);
            setIsPaymentModalOpen(false);
            setSelectedQueueId(null); 
            
            fetchActiveQueues(); 
            fetchProducts();

        } catch (err: any) {
            alert('Error: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate('/manage-login');
    };

    const NavLink = ({ to, label, onClick }: { to?: string; label: string; onClick?: () => void }) => {
        const isActive = to ? location.pathname === to : false;
        return (
            <button
                onClick={() => { if (onClick) onClick(); if (to) navigate(to); }}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-pink-100 text-pink-700' : 'text-gray-500 hover:text-pink-600 hover:bg-pink-50'}`}
            >
                {label}
            </button>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-gray-50">
            {/* Navbar */}
            <header className="bg-white shadow-sm px-6 py-4 flex justify-between items-center z-20 border-b border-pink-100">
                <div className="flex items-center gap-2">
                    <span className="text-2xl">🛍️</span>
                    <h1 className="text-xl font-bold text-gray-800">POS & Orders</h1>
                </div>
                <nav className="flex gap-2 bg-white p-1 rounded-lg border border-gray-100">
                    <NavLink to="/manage-events" label="Home" />
                    <NavLink to="/manage-products" label="Menu" />
                    <NavLink to="/manage-queues" label="Queue Control" />
                    <NavLink to="/manage-orders" label="POS" />
                    <NavLink onClick={handleLogout} label="Logout" />
                </nav>
            </header>

            <div className="flex-1 flex overflow-hidden">
                {/* LEFT PANEL: Cart */}
                <div className="w-1/3 bg-white border-r border-pink-100 flex flex-col shadow-xl z-10">
                    <div className="p-5 border-b border-pink-50 bg-pink-50/50 relative">
                        {/* ✅ UI ADDITION: แสดงชื่อ Event ตรงนี้ */}
                        <div className="flex justify-between items-start mb-1">
                            <h2 className="text-xs font-bold text-pink-500 uppercase tracking-wider">Current Customer</h2>
                            {activeEventName && (
                                <div className="flex items-center gap-1 bg-white/60 px-2 py-1 rounded-lg border border-pink-100 shadow-sm animate-fade-in">
                                    <Calendar size={20} className="text-pink-500" />
                                    <span className="text-s font-bold text-gray-700 max-w-[120px] truncate" title={activeEventName}>
                                        {activeEventName}
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="text-2xl font-extrabold text-gray-800">
                            {selectedQueueId
                                ? <span>Queue: <span className="text-pink-600">#{queues.find(q => q.id === selectedQueueId)?.queue_number}</span></span>
                                : "Walk-in Customer"}
                        </div>
                        {currentOrderId && <div className="text-xs text-green-600 font-bold mt-1">● Active Order Found</div>}
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-300 opacity-80">
                                <span className="text-5xl mb-3">🛒</span>
                                <p className="font-medium">Your cart is empty</p>
                            </div>
                        ) : (
                            cart.map((item) => (
                                <div key={item.product.id} className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-xl shadow-sm hover:shadow-md transition-all group">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <div className="w-10 h-10 shrink-0 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                                            {item.product.image_url ? (
                                                <img 
                                                    src={getProductImage(item.product.image_url)} 
                                                    alt={item.product.name} 
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/100x100?text=No+Img'; }}
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">No Img</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col truncate">
                                            <span className="font-bold text-sm text-gray-800 truncate block max-w-[120px]" title={item.product.name}>{item.product.name}</span>
                                            <span className="text-[10px] text-gray-400">฿{item.product.price}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1 ml-2">
                                        <span className="font-bold text-pink-600 text-sm">฿{(item.product.price * item.quantity).toLocaleString()}</span>
                                        <div className="flex items-center gap-2">
                                            <div className="flex items-center bg-gray-50 rounded-md border border-gray-200 h-6 shadow-sm">
                                                <button onClick={() => decreaseQuantity(item.product.id)} className="w-6 h-full flex items-center justify-center text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-l-md transition font-bold text-xs">-</button>
                                                <span className="min-w-[20px] text-center font-bold text-gray-700 text-xs">{item.quantity}</span>
                                                <button onClick={() => addToCart(item.product)} className="w-6 h-full flex items-center justify-center text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-r-md transition font-bold text-xs">+</button>
                                            </div>
                                            <button onClick={() => removeFromCart(item.product.id)} className="text-[10px] text-gray-400 hover:text-red-500 underline decoration-red-200">Remove</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    <div className="p-5 border-t border-pink-100 bg-white">
                        <div className="flex justify-between items-baseline mb-4">
                            <span className="text-gray-500 font-medium">Total Amount</span>
                            <span className="text-4xl font-extrabold text-gray-900">฿{totalPrice.toLocaleString()}</span>
                        </div>
                        <button disabled={cart.length === 0 || loading} onClick={() => setIsPaymentModalOpen(true)} className="w-full bg-pink-500 hover:bg-pink-600 text-white text-lg font-bold py-4 rounded-xl shadow-lg shadow-pink-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all active:scale-95">
                            {loading ? 'Processing...' : 'Charge ฿' + totalPrice.toLocaleString()}
                        </button>
                    </div>
                </div>

                {/* RIGHT PANEL: Product Catalog */}
                <div className="w-2/3 flex flex-col bg-gray-50/50">
                    <div className="bg-white px-4 pt-4 pb-2 flex flex-col gap-4 shadow-sm z-10">
                        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                            <button 
                                onClick={() => setSelectedQueueId(null)} 
                                className={`px-5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${selectedQueueId === null ? 'bg-pink-500 text-white shadow-md ring-2 ring-pink-200' : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}`}
                            >
                                Walk-in
                            </button>
                            <div className="w-px bg-gray-300 mx-1 h-6 self-center opacity-50"></div>
                            {queues.map(q => (
                                <button key={q.id} onClick={() => setSelectedQueueId(q.id)} className={`px-5 py-2 rounded-full text-sm font-bold whitespace-nowrap transition-all ${selectedQueueId === q.id ? 'bg-pink-500 text-white shadow-md ring-2 ring-pink-200' : 'bg-white border border-pink-200 text-gray-600 hover:bg-pink-50'}`}>#{q.queue_number}</button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white px-4 pb-4 border-b border-pink-100 shadow-sm z-10 flex flex-col gap-3">
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full pl-4 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-transparent bg-gray-50/50" />
                            </div>
                            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortType)} className="border border-gray-200 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-pink-400 text-gray-700 bg-white cursor-pointer font-medium min-w-[140px]">
                                <option value="name">Sort: Name</option>
                                <option value="price_low">Price: Low</option>
                                <option value="price_high">Price: High</option>
                            </select>
                        </div>
                        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                            {categories.map(cat => (
                                <button key={cat} onClick={() => setSelectedCategory(cat)} className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all whitespace-nowrap ${selectedCategory === cat ? 'bg-pink-500 text-white shadow-md ring-2 ring-pink-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{cat}</button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6">
                        {filteredProducts.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60"><p>No products found.</p></div>
                        ) : (
                            <div className="grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                                {filteredProducts.map((product) => (
                                    <div key={product.id} onClick={() => addToCart(product)} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden cursor-pointer hover:shadow-lg hover:-translate-y-1 transition-all duration-200 active:scale-95 group flex flex-col">
                                        <div className="h-28 bg-gray-100 relative overflow-hidden">
                                             {product.image_url ? (
                                                <img 
                                                    src={getProductImage(product.image_url)} 
                                                    alt={product.name} 
                                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
                                                    onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Img'; }} 
                                                />
                                             ) : (<div className="w-full h-full flex items-center justify-center text-2xl text-gray-300">📷</div>)}
                                        </div>
                                        <div className="p-2.5 flex flex-col justify-between flex-1">
                                            <div>
                                                <h3 className="font-bold text-gray-800 truncate text-sm" title={product.name}>{product.name}</h3>
                                                {product.category && <span className="text-[10px] text-gray-400 uppercase tracking-wide">{product.category}</span>}
                                            </div>
                                            <div className="flex justify-between items-end mt-1.5">
                                                <p className="text-pink-500 font-extrabold text-base">฿{product.price}</p>
                                                <button className="bg-gray-900 text-white text-[10px] px-2 py-1 rounded font-bold opacity-0 group-hover:opacity-100 transition-opacity">ADD</button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Payment Modal */}
            {isPaymentModalOpen && (
                <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-lg transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
                        <h3 className="text-3xl font-black text-gray-800 text-center mb-2">Confirm Payment</h3>
                        <p className="text-gray-500 text-center mb-8 text-lg">Amount due: <span className="text-pink-600 font-bold">฿{totalPrice.toLocaleString()}</span></p>
                        <div className="grid grid-cols-2 gap-5 mb-6">
                            <button onClick={() => handlePayment('cash')} className="flex flex-col items-center justify-center p-8 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-100 hover:border-emerald-300 rounded-2xl transition-all group active:scale-95"><span className="text-5xl mb-3 group-hover:scale-110 transition-transform duration-200">💵</span><span className="font-bold text-emerald-700 text-lg tracking-wide">CASH</span></button>
                            <button onClick={() => handlePayment('transfer')} className="flex flex-col items-center justify-center p-8 bg-sky-50 hover:bg-sky-100 border-2 border-sky-100 hover:border-sky-300 rounded-2xl transition-all group active:scale-95"><span className="text-5xl mb-3 group-hover:scale-110 transition-transform duration-200">🏦</span><span className="font-bold text-sky-700 text-lg tracking-wide">TRANSFER</span></button>
                        </div>
                        <button onClick={() => setIsPaymentModalOpen(false)} className="w-full py-4 text-gray-400 font-bold hover:bg-gray-50 hover:text-gray-600 rounded-xl transition-colors active:scale-95">CANCEL</button>
                    </div>
                </div>
            )}
        </div>
    );
}