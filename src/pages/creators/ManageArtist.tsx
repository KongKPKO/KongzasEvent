import { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
  Trash2, Plus, Calendar, MapPin, FileText, 
  BarChart2, X, User, Ticket 
} from 'lucide-react'; 
import { Button } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import AvatarUpload from '../../components/AvatarUpload';
import AdminHeader from '../../components/AdminHeader';

interface Artist {
  id: string;
  display_name: string;
  bio: string;
  image_url: string;

  x_url: string;
  ig_url: string;
  facebook_url: string;
  tiktok_url: string;
  email: string;
}

interface Event {
  id: string;
  artist_id: string;
  event_name: string;
  location_name: string;
  location_detail: string;

  entrance_fee: string;
  transit_info: string;
  start_date: string;
  end_date: string;
  status: 'Confirmed' | 'Cancelled';
}

const ManageArtist = () => {
  const navigate = useNavigate();
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<Event>>({});
  const [isEditingEvent, setIsEditingEvent] = useState(false);

  // Stats Modal State
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        if (isMounted) setIsLoading(true);

        // 1. Get User
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
           navigate('/manage-login'); // Force redirect
           return;
        }

        // 2. Fetch Artist by User ID
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('*')
          .eq('id', user.id)
          .single();

        if (artistError) throw artistError;

        if (isMounted && artistData) {
          setArtist(artistData);

          // 2. Fetch Events
          const { data: eventData, error: eventError } = await supabase
            .from('events')
            .select('*')
            .eq('artist_id', artistData.id)
            .order('start_date', { ascending: true });

          if (eventError) throw eventError;

          if (isMounted) {
            setEvents(eventData || []);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, []);



  // --- Profile Actions ---

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!artist) return;
    setArtist({ ...artist, [e.target.name]: e.target.value });
  };

  const handleAvatarUpload = async (url: string) => {
    if (!artist) return;
    try {
       // 1. Update Local State (Optimistic)
       setArtist({ ...artist, image_url: url });

       // 2. IMMEDIATE SAVE to DB
       const { error } = await supabase
          .from('artists')
          .update({ image_url: url })
          .eq('id', artist.id);

       if (error) throw error;
       alert('Profile picture updated successfully!');
    } catch (error) {
       console.error("Error saving avatar:", error);
       alert('Failed to save profile picture.');
    }
  };

  const handleProfileSave = async () => {
    if (!artist) return;
    try {
      setIsSaving(true);
      const { error } = await supabase
        .from('artists')
        .update({
          display_name: artist.display_name,
          bio: artist.bio,
          x_url: artist.x_url,
          ig_url: artist.ig_url,
          facebook_url: artist.facebook_url,
          tiktok_url: artist.tiktok_url,
          email: artist.email,
          image_url: artist.image_url
        })
        .eq('id', artist.id);

      if (error) throw error;
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile.");
    } finally {
      setIsSaving(false);
    }
  };

  // --- Event Actions ---

  const handleOpenModal = (event?: Event) => {
    if (event) {
      setCurrentEvent(event);
      setIsEditingEvent(true);
    } else {
      setCurrentEvent({
        event_name: '',
        location_name: '',
        location_detail: '',

        entrance_fee: '',
        transit_info: '',
        start_date: '',
        end_date: '',
        status: 'Confirmed'
      });
      setIsEditingEvent(false);
    }
    setIsModalOpen(true);
  };

  const handleFunctionChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setCurrentEvent({ ...currentEvent, [e.target.name]: e.target.value });
  };

  const handleEventSave = async () => {
    if (!artist || !currentEvent.event_name || !currentEvent.start_date || !currentEvent.end_date) {
      alert("Please fill in required fields (Name, Start Date, End Date)");
      return;
    }

    try {
      setIsSaving(true);
      
      const eventPayload = {
        ...currentEvent,
        artist_id: artist.id,
      };
      // Remove id if it's undefined (new event) to let DB generate it
      if (!isEditingEvent) delete eventPayload.id;

      const { data, error } = await supabase
        .from('events')
        .upsert(eventPayload)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        if (isEditingEvent) {
          setEvents(events.map(e => e.id === data.id ? data : e));
        } else {
          setEvents([...events, data].sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));
        }
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Error saving event:", error);
      alert("Failed to save event.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEventDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const { error } = await supabase.from('events').delete().eq('id', id);
      if (error) throw error;
      setEvents(events.filter(e => e.id !== id));
    } catch (error) {
       console.error("Error deleting event:", error);
       alert("Failed to delete event.");
    }
  };

  // --- STATS LOGIC ---
  const handleOpenStats = async (event: Event) => {
      setCurrentEvent(event);
      setIsStatsModalOpen(true);
      setLoadingStats(true);
      setSummaryStats(null);

      try {
         const { data: queues, error } = await supabase
            .from('queues')
            .select('*')
            .eq('event_id', event.id);

         if (error) throw error;

         if (queues) {
            // 1. Count Statuses
            const total = queues.length;
            const served = queues.filter(q => q.status === 'complete').length;
            const cancelled = queues.filter(q => q.status === 'missed').length; // User Cancelled
            const expired = queues.filter(q => q.status === 'expired').length;   // System Expired
            
            // 2. Calc Averages
            let totalWaitTime = 0;
            let waitCount = 0;
            let totalServiceTime = 0;
            let serviceCount = 0;

            queues.forEach(q => {
               if (q.created_at && (q.served_at || q.called_at)) {
                  const endTime = q.served_at ? new Date(q.served_at).getTime() : new Date(q.called_at).getTime();
                  const wait = (endTime - new Date(q.created_at).getTime()) / 60000;
                  
                  if (wait > 0 && wait < 600) { 
                     totalWaitTime += wait;
                     waitCount++;
                  }
               }

               if (q.status === 'complete' && q.completed_at && (q.served_at || q.called_at)) {
                   const startTime = q.served_at ? new Date(q.served_at).getTime() : new Date(q.called_at).getTime();
                   const service = (new Date(q.completed_at).getTime() - startTime) / 60000;
                   
                   if (service > 0 && service < 300) { 
                       totalServiceTime += service;
                       serviceCount++;
                   }
               }
            });

            setSummaryStats({
               total,
               served,
               cancelled,
               expired,
               avgWait: waitCount > 0 ? Math.round(totalWaitTime / waitCount) : 0,
               avgService: serviceCount > 0 ? Math.round(totalServiceTime / serviceCount) : 0
            });
         }

      } catch (err) {
         console.error("Error fetching stats:", err);
      } finally {
         setLoadingStats(false);
      }
  };


  if (isLoading) return <div className="flex h-screen items-center justify-center text-pink-500 font-bold">Loading Artist Center...</div>;
  if (!artist) return <div className="flex h-screen items-center justify-center text-gray-500">Artist not found.</div>;

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-800">
       
       {/* ✅ Unified Admin Header */}
       <AdminHeader activePage="events" />

      {/* Main Content */}
      <div className="w-full max-w-[1140px] mx-auto px-4 md:px-6 pb-12 pt-2 overflow-x-hidden">
        
        {/* Header */}
        <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
           <div>
              <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage profile and events</h1>
              <p className="text-sm md:text-base text-pink-600 font-bold">{artist.display_name}</p>
           </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- LEFT COL: Profile Settings --- */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-auto self-start">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
               <User className="text-[#ff4d94]" size={16} />
               <h2 className="font-bold text-sm text-slate-800">Profile Settings</h2>
            </div>
            
            <div className="p-4 space-y-3">
               {/* Avatar Upload */}
               <div className="flex justify-center mb-2">
                  <AvatarUpload 
                    artistId={artist.id}
                    currentImageUrl={artist.image_url}
                    onUploadComplete={handleAvatarUpload}
                  />
               </div>

               {/* Display Name */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Display Name</label>
                  <input 
                    name="display_name"
                    value={artist.display_name}
                    onChange={handleProfileChange}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all"
                  />
               </div>

               {/* Bio */}
               <div className="space-y-0.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Bio</label>
                  <textarea 
                    name="bio"
                    value={artist.bio}
                    onChange={handleProfileChange}
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded px-3 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-pink-500/50 focus:border-pink-500 transition-all resize-none leading-relaxed"
                  />
               </div>

               <div className="h-px bg-gray-100 my-0.5"></div>

               {/* Socials */}
               <div className="space-y-1">
                  <h3 className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-0.5">Social Links</h3>
                  <div className="flex flex-col gap-1">
                     {['x_url', 'ig_url', 'facebook_url', 'tiktok_url', 'email'].map((field) => (
                       <div key={field} className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                             <span className="text-[9px] font-bold text-gray-400 uppercase w-16 truncate">
                                {field.replace('_url', '').replace('email', 'Email')}
                             </span>
                          </div>
                          <input 
                             name={field}
                             value={(artist as any)[field] || ''}
                             onChange={handleProfileChange}
                             placeholder={field === 'email' ? 'contact@email.com' : '...'}
                             className="w-full bg-white border border-gray-200 rounded pl-16 pr-2 py-1 text-xs font-medium text-slate-600 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 transition-all"
                          />
                       </div>
                     ))}
                  </div>
               </div>

               <Button 
                 onClick={handleProfileSave} 
                 disabled={isSaving}
                 className="w-full mt-1 bg-[#ff4d94] hover:bg-[#e63e80] text-white font-bold h-9 text-xs rounded shadow-md shadow-pink-200 active:scale-95 transition-all"
               >
                 {isSaving ? 'Saving...' : 'Save Updates'}
               </Button>
            </div>
          </div>


          {/* --- RIGHT COL: Event Management --- */}
          <div className="lg:col-span-2 space-y-6">
             
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px] flex flex-col">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                   <div className="flex items-center gap-2">
                     <Calendar className="text-[#ff4d94]" size={20} />
                     <h2 className="font-bold text-lg text-slate-800">Event Management</h2>
                     <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full text-xs font-bold">{events.length}</span>
                   </div>
                   <Button onClick={() => handleOpenModal()} className="bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-bold px-4 h-9 shadow-sm flex items-center gap-2">
                      <Plus size={14} /> Add Event
                   </Button>
                </div>

                <div className="p-0 flex-1 overflow-x-auto">
                   {events.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-gray-300 py-20">
                         <Calendar size={48} className="mb-4 opacity-20" />
                         <p className="font-medium">No events scheduled.</p>
                      </div>
                   ) : (
                      <table className="w-full text-left border-collapse">
                         <thead>
                            <tr className="bg-gray-50/50 text-xs text-gray-400 uppercase tracking-wider border-b border-gray-100">
                               <th className="px-6 py-4 font-bold">Date</th>
                               <th className="px-6 py-4 font-bold">Event</th>
                               <th className="px-6 py-4 font-bold">Location</th>
                               <th className="px-6 py-4 font-bold text-right">Actions</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-gray-50">
                            {events.map((evt) => (
                               <tr key={evt.id} className="hover:bg-pink-50/30 transition-colors group">
                                  <td className="px-6 py-4">
                                     <div className="flex flex-col">
                                        <span className="text-sm font-bold text-slate-800">
                                           {new Date(evt.start_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                                        </span>
                                        <span className="text-[10px] text-gray-400 font-medium">
                                           {new Date(evt.start_date).getFullYear()}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-6 py-4">
                                     <div className="font-bold text-slate-900 text-sm">{evt.event_name}</div>
                                     <div className="flex items-center gap-3 mt-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${evt.status === 'Cancelled' ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                           {evt.status}
                                        </span>

                                        {evt.entrance_fee && (
                                           <span className="flex items-center gap-1 text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                              <Ticket size={10} /> {evt.entrance_fee}
                                           </span>
                                        )}
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                                     <div className="flex items-start gap-1.5">
                                        <MapPin size={12} className="shrink-0 mt-0.5 text-pink-400" />
                                        <span>
                                           {evt.location_name}
                                           {evt.location_detail && <span className="block text-gray-400 text-[10px]">{evt.location_detail}</span>}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                          onClick={() => handleOpenStats(evt)}
                                          className="text-gray-400 hover:text-pink-600 hover:bg-pink-50 p-1.5 rounded-md transition-colors"
                                          title="View Queue Stats"
                                        >
                                           <BarChart2 size={20} />
                                        </button>
                                        
                                        {/* ✅ BUTTON: Sales History */}
                                        <button 
                                          onClick={() => navigate(`/manage-events/${evt.id}/history`)}
                                          className="text-gray-400 hover:text-green-600 hover:bg-green-50 p-1.5 rounded-md transition-colors"
                                          title="View Sales History"
                                        >
                                           <FileText size={20} />
                                        </button>

                                        <button 
                                          onClick={() => handleOpenModal(evt)}
                                          className="text-xs font-semibold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-md transition-colors"
                                        >
                                           Edit
                                        </button>
                                        <button 
                                          onClick={() => handleEventDelete(evt.id)}
                                          className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-colors"
                                        >
                                           <Trash2 size={20} />
                                        </button>
                                      </div>
                                   </td>
                                </tr>
                            ))}
                         </tbody>
                      </table>
                   )}
                </div>
             </div>

          </div>
        </div>
        
      </div>
      
      {/* --- ADD/EDIT MODAL --- */}
      {isModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <h3 className="font-bold text-lg text-slate-800">{isEditingEvent ? 'Edit Event' : 'New Event'}</h3>
                  <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                     <div className="space-y-1 flex-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Status</label>
                        <select name="status" value={currentEvent.status || 'Confirmed'} onChange={handleFunctionChange} className="w-full bg-white border border-gray-200 rounded-md p-2 text-sm font-semibold focus:border-pink-500 outline-none">
                           <option value="Confirmed">Confirmed</option>
                           <option value="Cancelled">Cancelled</option>
                        </select>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Event Name *</label>
                     <input name="event_name" value={currentEvent.event_name} onChange={handleFunctionChange} className="input-field w-full border border-gray-200 rounded-lg p-3 font-semibold focus:ring-pink-500 focus:border-pink-500 outline-none" placeholder="e.g. Cosplay Festival 2026" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Start Date *</label>
                        <input type="datetime-local" name="start_date" value={currentEvent.start_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">End Date *</label>
                        <input type="datetime-local" name="end_date" value={currentEvent.end_date} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Location Name</label>
                        <input name="location_name" value={currentEvent.location_name || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. BITEC Bangna" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Location Detail</label>
                     <input name="location_detail" value={currentEvent.location_detail || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. Hall 98, Near Entrance 2" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Entrance Fee</label>
                     <input name="entrance_fee" value={currentEvent.entrance_fee || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. 300 THB / Free" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Transit Info</label>
                     <textarea name="transit_info" rows={3} value={currentEvent.transit_info || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500 resize-none" placeholder="BTS Bangna..." />
                  </div>
               </div>

               <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="text-gray-500">Cancel</Button>
                  <Button onClick={handleEventSave} className="bg-pink-500 hover:bg-pink-600 text-white font-bold px-6 shadow-md shadow-pink-200">
                     {isSaving ? 'Saving...' : 'Save Event'}
                  </Button>
               </div>
            </div>
         </div>
      )}

      {/* --- STATS MODAL --- */}
      {isStatsModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col">
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <div className="flex items-center gap-2">
                     <BarChart2 className="text-[#ff4d94]" size={20} />
                     <div>
                        <h3 className="font-bold text-lg text-slate-800">Performance Summary</h3>
                        <p className="text-xs text-gray-400 font-medium">{currentEvent.event_name}</p>
                     </div>
                  </div>
                  <button onClick={() => setIsStatsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-8">
                  {loadingStats ? (
                     <div className="py-12 text-center text-gray-400 font-medium animate-pulse">Calculating metrics...</div>
                  ) : summaryStats ? (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* Total Tickets */}
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 text-center">
                           <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Limit</div>
                           <div className="text-3xl font-black text-slate-800">{summaryStats.total}</div>
                           <div className="text-[10px] text-gray-400 mt-1">Tickets Issued</div>
                        </div>

                        {/* Served */}
                        <div className="bg-green-50 p-4 rounded-xl border border-green-100 text-center">
                           <div className="text-xs font-bold text-green-600 uppercase tracking-wider mb-1">Served</div>
                           <div className="text-3xl font-black text-green-700">{summaryStats.served}</div>
                           <div className="text-[10px] text-green-600/70 mt-1">
                              {summaryStats.total > 0 ? Math.round((summaryStats.served / summaryStats.total) * 100) : 0}% Rate
                           </div>
                        </div>

                        {/* Avg Wait */}
                        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-center">
                           <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Avg Wait</div>
                           <div className="text-3xl font-black text-blue-700">{summaryStats.avgWait}<span className="text-sm font-bold text-blue-400 ml-1">m</span></div>
                           <div className="text-[10px] text-blue-600/70 mt-1">To Get Called</div>
                        </div>

                        {/* Avg Service */}
                        <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-center">
                           <div className="text-xs font-bold text-purple-600 uppercase tracking-wider mb-1">Avg Service</div>
                           <div className="text-3xl font-black text-purple-700">{summaryStats.avgService}<span className="text-sm font-bold text-purple-400 ml-1">m</span></div>
                           <div className="text-[10px] text-purple-600/70 mt-1">At Counter</div>
                        </div>

                        {/* Missed / Cancelled Split */}
                         <div className="bg-red-50 p-4 rounded-xl border border-red-100 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-red-700 font-bold text-sm">Cancelled</div>
                              <div className="text-red-400 text-[10px]">By User</div>
                           </div>
                           <div className="text-3xl font-black text-red-600">{summaryStats.cancelled}</div>
                        </div>

                         <div className="bg-gray-100 p-4 rounded-xl border border-gray-200 text-center col-span-2 mt-2 flex items-center justify-between px-6">
                           <div className="text-left">
                              <div className="text-gray-700 font-bold text-sm">Expired</div>
                              <div className="text-gray-400 text-[10px]">System Removal</div>
                           </div>
                           <div className="text-3xl font-black text-gray-600">{summaryStats.expired}</div>
                        </div>

                     </div>
                  ) : (
                     <div className="text-center text-gray-400">No data available.</div>
                  )}
               </div>

               <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                  <Button onClick={() => setIsStatsModalOpen(false)} variant="ghost" className="text-gray-500 hover:text-gray-700">Close</Button>
               </div>
            </div>
         </div>
      )}

    </div>
  );
};

export default ManageArtist;