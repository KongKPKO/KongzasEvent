import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { Button, Card } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import { Loader, Trash2, Upload, Plus, FileText, Edit2, X, Search, ArrowUpDown, ChevronDown } from 'lucide-react';
import Papa from 'papaparse';
import imageCompression from 'browser-image-compression';
import { getOptimizedImageUrl } from '../../utils/imageUtils';
import AdminHeader from '../../components/AdminHeader';

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string;
  description?: string;
  category?: string;
  status?: 'enable' | 'disable' | 'soldout';
}

const ManageProducts = () => {
   const navigate = useNavigate();
   const [products, setProducts] = useState<Product[]>([]);
   const [loading, setLoading] = useState(true);
   const [uploading, setUploading] = useState(false);
   const [compressing, setCompressing] = useState(false);
   
   // Form State
   const [name, setName] = useState('');
   const [price, setPrice] = useState('');
   const [description, setDescription] = useState('');
   const [category, setCategory] = useState(''); // Default
   const [status, setStatus] = useState('enable'); // Default
   const [file, setFile] = useState<File | null>(null);
   const fileInputRef = useRef<HTMLInputElement>(null);
   
   // Filter & Sort State
   const [searchQuery, setSearchQuery] = useState('');
   const [selectedCategory, setSelectedCategory] = useState('All');
   const [sortOption, setSortOption] = useState('name_asc');

   // Edit Modal State
   const [isEditModalOpen, setIsEditModalOpen] = useState(false);
   const [editingProduct, setEditingProduct] = useState<Product | null>(null);
   const [editFile, setEditFile] = useState<File | null>(null);
   const editFileInputRef = useRef<HTMLInputElement>(null);
   const csvInputRef = useRef<HTMLInputElement>(null);
   
   const [, setArtistId] = useState<string>('');
   const [artistName, setArtistName] = useState<string>('');

   const categories = [
      "A3", "A4", "Badge", "Cheki", "Keychain", 
      "Photo4*6", "Photocard", "Shaker", "Standy", "Sticker"
   ].sort().concat(["Other"]);
   
   // Derived Data for Suggestions (Unique Categories from Products + Defaults)
   // We use this for the datalist suggestions
   const allCategorySuggestions = Array.from(new Set([
      ...categories.filter(c => c !== 'Other'), // Defaults
      ...products.map(p => p.category?.trim()).filter(Boolean) as string[]
   ])).sort();

   // Derived Data for Filter Chips (includes "All")
   const uniqueCategories = ['All', ...Array.from(new Set(products.map(p => p.category || 'Other'))).sort()];

   const filteredProducts = products.filter(product => {
      const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCategory = selectedCategory === 'All' || (product.category || 'Other') === selectedCategory;
      return matchesSearch && matchesCategory;
   }).sort((a, b) => {
      if (sortOption === 'name_asc') return a.name.localeCompare(b.name);
      if (sortOption === 'price_asc') return a.price - b.price;
      if (sortOption === 'price_desc') return b.price - a.price;
      return 0;
   });

   const fetchProducts = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      // Fix: Force redirect if no session to prevent "Artist not found" errors
      if (!user) {
         navigate('/manage-login'); 
         return;
      }

      setArtistId(user.id);

      // Fetch Artist Name
      const { data: artist } = await supabase
         .from('artists')
         .select('display_name')
         .eq('id', user.id)
         .single();
      
      if (artist) setArtistName(artist.display_name);



      const { data, error } = await supabase
         .from('products')
         .select('*')
         .eq('artist_id', user.id)
         .order('created_at', { ascending: false });

      if (!error && data) {
         setProducts(data);
      }
      setLoading(false);
   };

   useEffect(() => {
      fetchProducts();
   }, []);

   const getProductImageUrl = (dbValue: string, width: number = 400) => {
      if (!dbValue) return '';
      let path = dbValue;
      if (dbValue.includes('http') && dbValue.includes('Menu/')) {
         const parts = dbValue.split('Menu/');
         if (parts.length > 1) path = parts[1];
      }
      const { data } = supabase.storage.from('Menu').getPublicUrl(path);
      
      // Use ImageKit Utility
      return getOptimizedImageUrl(data.publicUrl, width);
   };


   const handleImageCompression = async (imageFile: File): Promise<File> => {
      // Options for compression
      const options = {
         maxSizeMB: 0.2,           // 200KB
         maxWidthOrHeight: 1024,   // Max dimension
         useWebWorker: true,
         fileType: 'image/webp',   // Try to convert to WebP
         initialQuality: 0.8       // 80% quality at first
      };

      // If file is larger than 10MB, reject immediately
      if (imageFile.size > 10 * 1024 * 1024) {
         alert("File size must be less than 10MB");
         throw new Error("File too large");
      }
      // Skip if already small enough (e.g. < 200KB)
      if (imageFile.size / 1024 / 1024 < 0.2) {
         return imageFile; 
      }

      try {
         const compressedFile = await imageCompression(imageFile, options);
         // Keep original name but change extension if converted
         const newName = imageFile.name.replace(/\.[^/.]+$/, "") + '.webp';
         return new File([compressedFile], newName, { type: 'image/webp' });
      } catch (error) {
         console.warn('Image compression failed, using original.', error);
         return imageFile;
      }
   };

   const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
         const selectedFile = e.target.files[0];
         // Basic validation
         if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
            alert('Only JPG, PNG and WebP files are allowed.');
            return;
         }

         setCompressing(true);
         try {
             const compressed = await handleImageCompression(selectedFile);
             setFile(compressed);
         } catch (err) {
            setFile(selectedFile);
         } finally {
            setCompressing(false);
         }
      }
   };

   const handleAddProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name || !price || !file) {
         alert('Please fill in all fields and select an image.');
         return;
      }

      setUploading(true);
      try {
         const { data: { user } } = await supabase.auth.getUser();
         if (!user) throw new Error('Not authenticated');

         // 1. Upload Image
         const fileExt = file.name.split('.').pop();
         const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
         const filePath = `public/${fileName}`;

         const { error: uploadError } = await supabase.storage
            .from('Menu')
            .upload(filePath, file);

         if (uploadError) throw uploadError;

         // 2. Insert to DB
         const { error: dbError } = await supabase
            .from('products')
            .insert([{
               artist_id: user.id,
               name,
               price: parseFloat(price),
               description,
               category,
               status,
               image_url: filePath // Store relative path
            }]);

         if (dbError) throw dbError;

         // Reset Form
         setName('');
         setPrice('');
         setDescription('');
         setCategory('');
         setStatus('enable');
         setFile(null);
         if (fileInputRef.current) fileInputRef.current.value = '';
         
         await fetchProducts();
         alert('Product added successfully!');

      } catch (error: any) {
         console.error(error);
         alert(error.message || 'Error adding product');
      } finally {
         setUploading(false);
      }
   };

   const handleDeleteProduct = async (id: string, imageUrl: string) => {
      if (!confirm('Are you sure you want to delete this product?')) return;

      try {
         // 1. Delete from DB
         const { error: dbError } = await supabase
            .from('products')
            .delete()
            .eq('id', id);

         if (dbError) throw dbError;

         // 2. Delete from Storage (Optional but good practice)
         let path = imageUrl;
         if (imageUrl.includes('Menu/')) {
            path = imageUrl.split('Menu/')[1];
         }
         await supabase.storage.from('Menu').remove([path]);

         await fetchProducts();

      } catch (error) {
         console.error('Error deleting product', error);
         alert('Failed to delete product');
      }
   };

   const handleEditClick = (product: Product) => {
      setEditingProduct(product);
      setName(product.name);
      setPrice(product.price.toString());
      setDescription(product.description || '');
      setCategory(product.category || '');
      setStatus(product.status || 'enable');
      setEditFile(null);
      setIsEditModalOpen(true);
   };

   const handleEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
         const selectedFile = e.target.files[0];
         if (!['image/jpeg', 'image/png', 'image/webp'].includes(selectedFile.type)) {
            alert('Only JPG, PNG, and WebP files are allowed.');
            return;
         }

         setCompressing(true);
         try {
             const compressed = await handleImageCompression(selectedFile);
             setEditFile(compressed);
         } catch (err) {
             setEditFile(selectedFile);
         } finally {
             setCompressing(false);
         }
      }
   };

   const handleUpdateProduct = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editingProduct || !name || !price) {
         alert('Please fill in all required fields.');
         return;
      }

      setUploading(true);
      try {
         let imageUrl = editingProduct.image_url;

         // If new image selected, upload it
         if (editFile) {
            const fileExt = editFile.name.split('.').pop();
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
            const filePath = `public/${fileName}`;

            const { error: uploadError } = await supabase.storage
               .from('Menu')
               .upload(filePath, editFile);

            if (uploadError) throw uploadError;
            imageUrl = filePath;

            // Delete old image if it exists
            if (editingProduct.image_url) {
               let oldPath = editingProduct.image_url;
               if (oldPath.includes('Menu/')) {
                  oldPath = oldPath.split('Menu/')[1];
               }
               await supabase.storage.from('Menu').remove([oldPath]);
            }
         }

         // Update product in database
         const { error: dbError } = await supabase
            .from('products')
            .update({
               name,
               price: parseFloat(price),
               description,
               category,
               status,
               image_url: imageUrl
            })
            .eq('id', editingProduct.id);

         if (dbError) throw dbError;

         // Reset and refresh
         setIsEditModalOpen(false);
         setEditingProduct(null);
         setEditFile(null);
         setName('');
         setPrice('');
         setDescription('');
         setPrice('');
         setDescription('');
         setCategory('');
         setStatus('enable');
         
         await fetchProducts();
         alert('Product updated successfully!');

      } catch (error: any) {
         console.error(error);
         alert(error.message || 'Error updating product');
      } finally {
         setUploading(false);
      }
   };

   const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
         alert('Please upload a CSV file.');
         return;
      }

      Papa.parse(file, {
         header: true,
         skipEmptyLines: true,
         transformHeader: (header: string) => {
            // Trim whitespace and convert to lowercase for case-insensitive matching
            return header.trim().toLowerCase();
         },
         complete: async (results: Papa.ParseResult<Record<string, string>>) => {
            const rows = results.data as any[];
            if (!rows || rows.length === 0) {
               alert('CSV is empty.');
               return;
            }

            const validItems: any[] = [];
            const errors: string[] = [];

            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
               alert('Not authenticated');
               return;
            }

            rows.forEach((row: any, index: number) => {
               // Sanitize: trim all string values
               const sanitizedRow: any = {};
               Object.keys(row).forEach(key => {
                  const value = row[key];
                  sanitizedRow[key] = typeof value === 'string' ? value.trim() : value;
               });

               // Extract fields (case-insensitive)
               const name = sanitizedRow.name || sanitizedRow.Name || sanitizedRow.NAME;
               const priceRaw = sanitizedRow.price || sanitizedRow.Price || sanitizedRow.PRICE;
               const category = sanitizedRow.category || sanitizedRow.Category || sanitizedRow.CATEGORY;
               const description = sanitizedRow.description || sanitizedRow.Description || sanitizedRow.DESCRIPTION;

               // Validate required fields
               if (!name || !priceRaw) {
                  const missing = [];
                  if (!name) missing.push('name');
                  if (!priceRaw) missing.push('price');
                  errors.push(`Row ${index + 2}: Missing required field(s): ${missing.join(', ')}`);
                  return;
               }

               // Sanitize price: remove commas and parse
               const priceClean = priceRaw.toString().replace(/,/g, '');
               const price = parseFloat(priceClean);

               if (isNaN(price) || price <= 0) {
                  errors.push(`Row ${index + 2}: Invalid price value "${priceRaw}"`);
                  return;
               }

               validItems.push({
                  artist_id: user.id,
                  name: name,
                  price: price,
                  category: category || 'Other',
                  description: description || '',
                  image_url: ''
               });
            });

            // Log errors to console for debugging
            if (errors.length > 0) {
               console.warn('CSV Upload Validation Errors:');
               errors.forEach(err => console.warn(err));
            }

            if (validItems.length > 0) {
               try {
                  setUploading(true);
                  const { error } = await supabase.from('products').insert(validItems);
                  
                  if (error) throw error;

                  const message = `Successfully uploaded ${validItems.length} item(s)!${errors.length > 0 ? `\n\n${errors.length} row(s) skipped. Check console for details.` : ''}`;
                  alert(message);
                  if (csvInputRef.current) csvInputRef.current.value = '';
                  await fetchProducts();
               } catch (err: any) {
                  console.error('File upload error:', err);
                  alert('Failed to upload items. ' + err.message);
               } finally {
                  setUploading(false);
               }
            } else {
               alert(`No valid rows found.\n\n${errors.length > 0 ? errors.slice(0, 5).join('\n') + (errors.length > 5 ? `\n... and ${errors.length - 5} more errors.` : '') : "Ensure CSV has 'name' and 'price' columns."}`);
            }
         },
         error: (err: Error) => {
            console.error('CSV Parse Error:', err);
            alert('Failed to parse CSV file.');
         }
   });
   };

   return (
      <div className="min-h-screen bg-gray-50 font-sans text-gray-900 pb-20">
         {/* ✅ NEW: Unified Admin Header */}
         <AdminHeader activePage="menu" />
         
         {/* Page Title Wrapper */}
         <div className="max-w-5xl mx-auto px-6 pt-4 mb-2">
            <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage Products</h1>
            <p className="text-sm text-pink-600 font-bold">{artistName}</p>
         </div>

         <main className="max-w-5xl mx-auto px-6 pb-12">
            
            {/* ADD PRODUCT FORM */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6 animate-fade-in">
               <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
                     <Plus className="text-pink-500" size={18} />
                     Add New Item
                  </h2>
                  <div className="flex items-center gap-2">
                     <input 
                        type="file" 
                        ref={csvInputRef}
                        onChange={handleBulkUpload}
                        className="hidden"
                        accept=".csv"
                     />
                     <Button
                        type="button"
                        onClick={() => csvInputRef.current?.click()}
                        disabled={uploading}
                        className="bg-[#ff4d94] hover:bg-[#ff3385] text-white py-1.5 px-3 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 flex items-center gap-2 text-xs font-bold"
                     >
                        {uploading ? <Loader className="animate-spin" size={14} /> : <FileText size={14} />}
                        {uploading ? 'Uploading...' : 'Upload File'}
                     </Button>
                  </div>
               </div>
               
               <form onSubmit={handleAddProduct} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
                  <div className="lg:col-span-1 space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Product Name</label>
                     <input 
                        type="text" 
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-semibold rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                        placeholder="e.g. Iced Latte"
                        required
                     />
                  </div>
                  
                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Price (THB)</label>
                     <input 
                        type="number" 
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-semibold rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                        placeholder="0.00"
                        min="0"
                        step="0.01"
                        required
                     />
                  </div>

                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Category</label>
                     <input
                        list="category-suggestions"
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-semibold rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all"
                        placeholder="Select or type..."
                     />
                     <datalist id="category-suggestions">
                        {allCategorySuggestions.map(cat => (
                           <option key={cat} value={cat} />
                        ))}
                     </datalist>
                  </div>

                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Status</label>
                     <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-semibold rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all bg-white"
                     >
                        <option value="enable">Enable</option>
                        <option value="disable">Disable</option>
                        <option value="soldout">Sold Out</option>
                     </select>
                  </div>

                  <div className="space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">Image</label>
                     <div className="relative">
                        <input 
                           type="file" 
                           ref={fileInputRef}
                           onChange={handleFileChange}
                           className="hidden"
                           id="file-upload"
                           accept="image/png, image/jpeg"
                        />
                        <label 
                           htmlFor="file-upload" 
                           className={`w-full flex items-center justify-center px-3 py-1.5 border border-dashed rounded cursor-pointer transition-colors ${file ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                        >
                           <Upload size={14} className="mr-2" />
                           <span className="truncate text-xs font-medium">
                              {compressing ? 'Compressing...' : (file ? file.name : 'Choose Image')}
                           </span>
                        </label>
                     </div>
                     {compressing && <p className="text-[10px] text-pink-500 font-bold mt-1 animate-pulse">Optimizing image size...</p>}
                  </div>

                  <div className="lg:col-span-4 space-y-1">
                     <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Description 
                        <span className="text-[10px] text-gray-400 ml-2 font-normal">({description.length}/200)</span>
                     </label>
                     <textarea 
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                        className="w-full px-3 py-1.5 text-sm rounded border border-gray-200 focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-all h-16 resize-none"
                        placeholder="Brief description..."
                     />
                  </div>

                  <div className="lg:col-span-4 flex justify-end">
                     <Button 
                        type="submit" 
                        disabled={uploading}
                        className="bg-pink-500 hover:bg-pink-600 text-white py-2 px-6 rounded shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95 text-xs font-bold h-9"
                     >
                        {uploading ? <Loader className="animate-spin mx-auto" size={16} /> : 'Add Product'}
                     </Button>
                  </div>

               </form>
            </div>

            {/* FILTER & SORT SECTION */}
            <div className="mb-8 space-y-4">
               {/* Search & Sort Row */}
               <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                     <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                     <input 
                        type="text"
                        placeholder="Search products..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm"
                     />
                  </div>
                  
                  <div className="relative min-w-[200px]">
                     <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <ArrowUpDown className="text-gray-400" size={16} />
                     </div>
                     <select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value)}
                        className="w-full pl-10 pr-8 py-2.5 appearance-none rounded-xl border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all shadow-sm font-medium text-sm"
                     >
                        <option value="name_asc">Name (A-Z)</option>
                        <option value="price_asc">Price (Low to High)</option>
                        <option value="price_desc">Price (High to Low)</option>
                     </select>
                     <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={16} />
                  </div>
               </div>

               {/* Category Chips */}
               <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {uniqueCategories.map(cat => (
                     <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-4 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                           selectedCategory === cat 
                              ? 'bg-pink-500 text-white shadow-md shadow-pink-200' 
                              : 'bg-white border border-gray-200 text-gray-600 hover:border-pink-300 hover:text-pink-500'
                        }`}
                     >
                        {cat}
                     </button>
                  ))}
               </div>
            </div>

            {/* PRODUCT LIST */}
            <h2 className="text-lg font-bold text-gray-800 mb-4 px-1">Current Menu ({filteredProducts.length})</h2>
            
            {loading ? (
               <div className="text-center py-12 text-gray-400">Loading products...</div>
            ) : filteredProducts.length > 0 ? (
               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {filteredProducts.map(product => (
                     <Card key={product.id} className="overflow-hidden border border-gray-100 shadow-sm group hover:shadow-md transition-shadow">
                        <div className="aspect-square bg-gray-100 relative overflow-hidden">
                           <img 
                              src={getProductImageUrl(product.image_url, 400)} 
                              alt={product.name}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 bg-gray-200"
                              onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/400x400?text=No+Image'; }}
                           />
                           {product.status === 'disable' && (
                              <div className="absolute inset-0 bg-gray-900/80 flex items-center justify-center">
                                 <span className="text-white font-black text-sm tracking-wider border-2 border-white px-2 py-1 rotate-[-12deg]">DISABLED</span>
                              </div>
                           )}
                           {product.status === 'soldout' && (
                              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                 <span className="text-red-500 font-black text-sm tracking-wider border-2 border-red-500 px-2 py-1 rotate-[-12deg]">SOLD OUT</span>
                              </div>
                           )}
                           <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                              <Button 
                                 onClick={() => handleEditClick(product)}
                                 className="bg-blue-500 hover:bg-blue-600 text-white rounded-full p-2 h-auto w-auto"
                              >
                                 <Edit2 size={20} />
                              </Button>
                              <Button 
                                 onClick={() => handleDeleteProduct(product.id, product.image_url)}
                                 className="bg-red-500 hover:bg-red-600 text-white rounded-full p-2 h-auto w-auto"
                              >
                                 <Trash2 size={20} />
                              </Button>
                           </div>
                        </div>
                        <div className="p-1.5 flex flex-col h-full">
                           <div className="flex justify-between items-start mb-2">
                              <h3 className="font-bold text-gray-800 text-sm leading-tight line-clamp-2">{product.name}</h3>
                              <span className="text-pink-600 font-bold text-sm shrink-0">฿{product.price}</span>
                           </div>
                           
                           {product.category && (
                              <span className="inline-block px-2 py-0.5 bg-pink-50 text-pink-600 text-[10px] font-bold uppercase tracking-wider rounded-md self-start mb-2">
                                 {product.category}
                              </span>
                           )}

                           {product.description && (
                              <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-4">
                                 {product.description}
                              </p>
                           )}
                        </div>
                     </Card>
                  ))}
               </div>
            ) : (
               <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-200">
                  <span className="material-icons-outlined text-4xl text-gray-300 mb-2">restaurant_menu</span>
                  <p className="text-gray-500">No items available. Add your first product above.</p>
               </div>
            )}

         </main>

         {/* Edit Product Modal */}
         {isEditModalOpen && editingProduct && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
               <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                  <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                     <h2 className="text-xl font-bold text-gray-800">Edit Product</h2>
                     <button 
                        onClick={() => {
                           setIsEditModalOpen(false);
                           setEditingProduct(null);
                           setEditFile(null);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                     >
                        <X size={24} />
                     </button>
                  </div>
                  
                  <form onSubmit={handleUpdateProduct} className="p-6 space-y-4">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Name *</label>
                           <input 
                              type="text" 
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="e.g. Iced Latte"
                              required
                           />
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Price (THB) *</label>
                           <input 
                              type="number" 
                              value={price}
                              onChange={(e) => setPrice(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="0.00"
                              min="0"
                              step="0.01"
                              required
                           />
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
                           <input
                              list="category-suggestions"
                              type="text"
                              value={category}
                              onChange={(e) => setCategory(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                              placeholder="Select or type category..."
                           />
                           {/* Datalist is reusable, defined above in the Add form */}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Product Image</label>
                           <div className="relative">
                              <input 
                                 type="file" 
                                 ref={editFileInputRef}
                                 onChange={handleEditFileChange}
                                 className="hidden"
                                 id="edit-file-upload"
                                 accept="image/png, image/jpeg"
                              />
                              <label 
                                 htmlFor="edit-file-upload" 
                                 className={`w-full flex items-center justify-center px-4 py-2 border border-dashed rounded-lg cursor-pointer transition-colors ${editFile ? 'border-pink-500 bg-pink-50 text-pink-700' : 'border-gray-300 text-gray-500 hover:border-pink-400'}`}
                              >
                                 <Upload size={18} className="mr-2" />
                                 <span className="truncate text-sm">
                                    {compressing ? 'Compressing...' : (editFile ? editFile.name : 'Choose New Image')}
                                 </span>
                              </label>
                           </div>
                           {compressing && <p className="text-xs text-pink-500 font-bold mt-1 animate-pulse">Optimizing image size...</p>}
                        </div>

                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                           <select
                              value={status}
                              onChange={(e) => setStatus(e.target.value)}
                              className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all bg-white"
                           >
                              <option value="enable">Enable</option>
                              <option value="disable">Disable</option>
                              <option value="soldout">Sold Out</option>
                           </select>
                        </div>
                     </div>

                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                           Description 
                           <span className="text-xs text-gray-400 ml-2">({description.length}/200)</span>
                        </label>
                        <textarea 
                           value={description}
                           onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                           className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all h-24 resize-none"
                           placeholder="Brief description of the product..."
                        />
                     </div>

                     {editingProduct.image_url && !editFile && (
                        <div>
                           <label className="block text-sm font-medium text-gray-700 mb-2">Current Image</label>
                           <img 
                              src={getProductImageUrl(editingProduct.image_url, 200)} 
                              alt="Current"
                              loading="lazy"
                              decoding="async"
                              className="w-32 h-32 object-cover rounded-lg border border-gray-200 bg-gray-100"
                              onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/200x200?text=No+Image'; }}
                           />
                        </div>
                     )}

                     <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                        <Button 
                           type="button"
                           onClick={() => {
                              setIsEditModalOpen(false);
                              setEditingProduct(null);
                              setEditFile(null);
                           }}
                           className="px-6 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                           Cancel
                        </Button>
                        <Button 
                           type="submit" 
                           disabled={uploading}
                           className="bg-[#ff4d94] hover:bg-[#ff3385] text-white py-2 px-8 rounded-lg shadow-md shadow-pink-200 disabled:bg-pink-300 transition-all active:scale-95"
                        >
                           {uploading ? <Loader className="animate-spin mx-auto" size={20} /> : 'Save Changes'}
                        </Button>
                     </div>
                  </form>
               </div>
            </div>
         )}
      </div>
   );
};

export default ManageProducts;
