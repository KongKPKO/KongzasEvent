import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader, Plus, Trash2, X } from 'lucide-react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { useI18n } from '../../i18n';
import { getMenuImageUrl } from '../../utils/imageUtils';
import type { ProductParent, ProductBundleComponent } from '../../types/productFamily';

export interface BundleCandidate { id: string; name: string; product_kind?: string | null; is_unlimited?: boolean; status?: string; image_url?: string | null; currency?: string; }
interface Props {
 open: boolean; parent: ProductParent | null; products: BundleCandidate[];
 available: Record<string, number | null>; saving: boolean;
 onClose: () => void; onUpload: (file: File) => Promise<string>;
 onSave: (parent: Partial<ProductParent> & { name: string; base_price: number }, components: ProductBundleComponent[]) => Promise<void>;
}
const field='min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300';
export default function BundleEditor({open,parent,products,available,saving,onClose,onUpload,onSave}:Props) {
 const {language}=useI18n(); const th=language==='th';
 const [name,setName]=useState(''); const [price,setPrice]=useState(''); const [image,setImage]=useState(''); const [category,setCategory]=useState('');
 const [autoBundleEnabled,setAutoBundleEnabled]=useState(false);
 const [components,setComponents]=useState<ProductBundleComponent[]>([]); const [query,setQuery]=useState(''); const [error,setError]=useState(''); const [uploading,setUploading]=useState(false);
 const input=useRef<HTMLInputElement>(null); const ref=useDialogFocus<HTMLDivElement>(open,()=>{if(!saving&&!uploading)onClose();});
 useEffect(()=>{if(open){setName(parent?.name||'');setPrice(parent?String(parent.base_price):'');setImage(parent?.image_url||'');setCategory(parent?.category||'');setAutoBundleEnabled(parent?.auto_bundle_enabled??false);setComponents((parent?.bundle_items||[]).filter(x=>x.product_id).map(x=>({product_id:x.product_id!,quantity:x.quantity})));setQuery('');setError('');}},[open,parent]);
 if(!open)return null;
 const candidates=products.filter(p=>p.product_kind!=='bundle' && p.currency===(parent?.currency||'THB'));
 const matches=candidates.filter(p=>p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,30);
 const limits=components.map(c=>{const p=candidates.find(p=>p.id===c.product_id);return {name:p?.name||c.product_id,quantity:p?.status!=='enable'?0:available[c.product_id],count:c.quantity};});
 const finite=limits.filter(l=>l.quantity!=null); const capacity=finite.length?Math.min(...finite.map(l=>Math.floor(l.quantity!/l.count))):null;
 const limiting=finite.find(l=>Math.floor(l.quantity!/l.count)===capacity);
 const save=async()=>{setError('');if(!name.trim()||price===''||!Number.isFinite(Number(price))||Number(price)<0||!components.length||components.some(c=>!Number.isSafeInteger(c.quantity)||c.quantity<1||c.quantity>10000)){setError(th?'กรอกชื่อ ราคา และเลือกสินค้าพร้อมจำนวนให้ครบ':'Enter a name, price, and component quantities.');return;}try{await onSave({...parent,name:name.trim(),base_price:Number(price),category:category.trim(),image_url:image,currency:parent?.currency||'THB',auto_bundle_enabled:autoBundleEnabled},components);}catch(e){setError(e instanceof Error?e.message:String(e));}};
 return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="bundle-title" className="fixed inset-0 z-[140] flex items-center justify-center bg-black/50 p-3 sm:p-6">
 <section className="flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl">
 <header className="flex shrink-0 items-center justify-between border-b p-5"><div><h2 id="bundle-title" className="text-xl font-black">{parent?(th?'แก้ไขชุดสินค้า':'Edit bundle'):(th?'สร้างชุดสินค้า':'Create bundle')}</h2><p className="mt-1 text-sm text-gray-500">{th?'เลือกสินค้าที่สร้างไว้แล้ว ชุดใช้สต็อกร่วมกับการขายแยก':'Choose existing products. Bundles share stock with individual sales.'}</p></div><button type="button" aria-label={th?'ปิดชุดสินค้า':'Close bundle'} onClick={onClose} disabled={saving||uploading} className="grid h-11 w-11 place-items-center"><X/></button></header>
 <fieldset disabled={saving||uploading} className="grid min-h-0 min-w-0 gap-5 overflow-y-auto bg-gray-50 p-5 md:grid-cols-2">
 <div className="space-y-4 rounded-2xl border bg-white p-4">
 <label className="block text-sm font-bold">{th?'ชื่อชุดสินค้า':'Bundle name'}<input className={field} value={name} onChange={e=>setName(e.target.value)} placeholder="Set Mavuika"/></label>
 <label className="block text-sm font-bold">{th?'ราคาชุด':'Bundle price'}<input className={field} type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/></label>
 <label className="block text-sm font-bold">{th?'หมวดหมู่':'Category'}<input className={field} value={category} onChange={e=>setCategory(e.target.value)} placeholder={th?'เช่น เซ็ตพิเศษ':'e.g. Special sets'}/></label>
 <label className="flex min-h-11 items-start gap-3 rounded-xl border border-pink-100 bg-pink-50 p-3 text-sm">
  <input type="checkbox" checked={autoBundleEnabled} onChange={e=>setAutoBundleEnabled(e.target.checked)} className="mt-1 h-4 w-4 accent-pink-600"/>
  <span><strong className="block">{th?'จัดชุดให้อัตโนมัติเมื่อคุ้มกว่า':'Automatically bundle matching items'}</strong><span className="mt-1 block text-xs font-normal text-gray-600">{th?'เมื่อสินค้าที่เลือกตรงกับชุด ระบบจะใช้ราคาชุดหากราคาไม่สูงกว่าการซื้อแยก':'When selected items exactly match this recipe, use the bundle price when it does not cost more than buying separately.'}</span></span>
 </label>
 {image&&<img src={getMenuImageUrl(image)} alt={name} className="max-h-56 w-full rounded-xl object-contain"/>}
 <input ref={input} type="file" accept="image/*" className="hidden" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setUploading(true);setError('');try{setImage(await onUpload(file));}catch(err){setError(err instanceof Error?err.message:String(err));}finally{setUploading(false);e.target.value='';}}}/>
 <button type="button" disabled={uploading||saving} onClick={()=>input.current?.click()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 font-bold text-pink-700">{uploading?<Loader className="animate-spin" size={16}/>:<ImagePlus size={16}/>} {th?'อัปโหลดรูปปกชุด':'Upload bundle cover'}</button>
 {image&&<button type="button" onClick={()=>setImage('')} className="min-h-11 px-3 text-red-600">{th?'ลบรูป':'Remove image'}</button>}
 <div className="rounded-xl bg-pink-50 p-3 text-sm"><strong>{components.length?(capacity==null?(th?'ไม่จำกัดจำนวน':'Unlimited'):(th?`พร้อมจัดชุด ${capacity} ชุด`:`${capacity} bundles available`)):(th?'เลือกสินค้าเพื่อคำนวณจำนวนชุด':'Select products to calculate availability')}</strong>{limiting&&<p>{th?'จำกัดโดย':'Limited by'} {limiting.name}</p>}<p className="mt-2 text-xs text-gray-600">{th?'คำนวณจากของที่ยังไม่จัดสรร เมื่อขายในอีเวนต์หรือออนไลน์ จะใช้ของที่จัดสรรให้ช่องทางนั้น เติมของที่สินค้าส่วนประกอบ':'Based on unallocated stock. Channel sales use components allocated to that channel. Receive stock on the component products.'}</p></div>
 </div>
 <div className="space-y-3 rounded-2xl border bg-white p-4"><h3 className="font-black">{th?'สินค้าในชุด':'Products in this bundle'}</h3>
 {parent&&!parent.bundle_items?.some(i=>i.product_id)&&<p className="rounded-xl bg-amber-50 p-3 text-sm">{th?'ชุดเดิมยังไม่ได้เชื่อมสินค้า กรุณาเลือกส่วนประกอบ หากมีประวัติขายแล้วให้สร้างชุดใหม่เพื่อเก็บประวัติเดิม':'This legacy bundle has no linked components. Select them explicitly; used legacy bundles require a new bundle to preserve history.'}</p>}
 {components.map(c=>{const p=products.find(p=>p.id===c.product_id);return <div key={c.product_id} className="rounded-xl border p-3"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-sm font-bold">{p?.name||c.product_id}</span><input aria-label={`${th?'จำนวนต่อชุด':'Quantity per bundle'} ${p?.name}`} type="number" min="1" max="10000" value={c.quantity||''} onChange={e=>setComponents(cs=>cs.map(x=>x.product_id===c.product_id?{...x,quantity:Number(e.target.value)}:x))} className={`${field} !w-20`}/><button type="button" aria-label={`${th?'นำออก':'Remove'} ${p?.name}`} onClick={()=>setComponents(cs=>cs.filter(x=>x.product_id!==c.product_id))} className="grid h-11 w-11 place-items-center text-red-600"><Trash2 size={16}/></button></div>{c.quantity>1&&<p className="mt-2 text-xs text-amber-700">{th?`รายการนี้ใช้ ${c.quantity} ชิ้นต่อชุด`:`This item uses ${c.quantity} units per bundle.`}</p>}</div>;})}
 <label className="block text-sm font-bold">{th?'ค้นหาสินค้าเพื่อเพิ่มในชุด':'Search products to add'}<input value={query} onChange={e=>setQuery(e.target.value)} className={field}/></label>
 <div className="max-h-64 overflow-y-auto">{matches.map(p=><button type="button" key={p.id} onClick={()=>setComponents(cs=>cs.some(x=>x.product_id===p.id)?cs.map(x=>x.product_id===p.id?{...x,quantity:x.quantity+1}:x):[...cs,{product_id:p.id,quantity:1}])} className="flex min-h-11 w-full items-center justify-between gap-2 border-b p-2 text-left text-sm hover:bg-pink-50"><span>{p.name}</span><Plus size={16}/></button>)}{!matches.length&&<p className="p-3 text-sm text-gray-500">{th?'ไม่พบสินค้า กรุณาสร้างสินค้าก่อน':'No products found. Create the products first.'}</p>}</div>
 </div></fieldset>
 <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t p-4">{error&&<p role="alert" className="w-full text-sm text-red-600">{error}</p>}<button type="button" onClick={onClose} disabled={saving||uploading} className="min-h-11 rounded-xl border px-4">{th?'ยกเลิก':'Cancel'}</button><button type="button" disabled={saving||uploading} onClick={()=>void save()} className="min-h-11 rounded-xl bg-pink-600 px-5 font-bold text-white disabled:opacity-50">{saving?<Loader className="animate-spin"/>:(th?'บันทึกชุดสินค้า':'Save bundle')}</button></footer>
 </section></div>;
}
