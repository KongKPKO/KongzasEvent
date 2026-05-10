import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import {
  Trash2, Plus, Calendar, MapPin, FileText,
  BarChart2, X, User, Ticket, ExternalLink, Copy, Users, ShoppingCart
} from 'lucide-react';
import { Button } from '../../components/ui';
import { useNavigate } from 'react-router-dom';
import AvatarUpload from '../../components/AvatarUpload';
import AdminHeader from '../../components/AdminHeader';
import { getAuthUserSafe } from '../../utils/auth';
import { normalizeEventRecord } from '../../utils/schemaCompat';
import {
  formatDateTimeForInput,
  getBrowserTimeZone,
  getEventTimeZoneOptions,
  parseDateTimeInputInTimeZone,
} from '../../utils/timezone';

interface Artist {
  id: string;
  slug?: string;
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
  event_timezone?: string | null;
  is_booth_open?: boolean;
  location?: string | null;
  booth_detail?: string | null;
  queueing_area?: string | null;
  location_name?: string | null;
  location_detail?: string | null;
  booth_number?: string | null;
  entrance_fee: string;
  transit_info: string;
  start_date: string;
  end_date: string;
  status: 'Confirmed' | 'Cancelled' | 'Ended';
}

const ManageArtist = () => {
  const navigate = useNavigate();
  const browserTimeZone = getBrowserTimeZone();
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<Partial<Event>>({});
  const [isEditingEvent, setIsEditingEvent] = useState(false);
  const timeZoneOptions = useMemo(
    () => getEventTimeZoneOptions(currentEvent.event_timezone || browserTimeZone),
    [currentEvent.event_timezone, browserTimeZone]
  );

  // Filter State
  const [filterMonth, setFilterMonth] = useState<number | 'all'>('all');
  const [filterYear, setFilterYear] = useState<number | 'all'>('all');

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        if (isMounted) setIsLoading(true);

        // 1. Get User
        const user = await getAuthUserSafe();
        if (!user) {
           navigate('/manage-login'); // Force redirect
           return;
        }

        // 2. Fetch Artist by User ID
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, image_url, x_url, ig_url, facebook_url, tiktok_url, email')
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
            const normalizedEvents = (eventData || []).map((evt: Event) =>
              normalizeEventRecord(evt, browserTimeZone) as Event
            );

            // Auto-update events that have passed end_date to 'Ended'
            const now = new Date();
            const updatedEvents = normalizedEvents.map((evt: Event) => {
              if (evt.status === 'Confirmed' && new Date(evt.end_date) < now) {
                return { ...evt, status: 'Ended' as const };
              }
              return evt;
            });

            // Update in database for events that need to be marked as Ended
            const endedEventIds = updatedEvents
              .filter((evt: Event, idx: number) => 
                normalizedEvents[idx]?.status === 'Confirmed' && evt.status === 'Ended'
              )
              .map((evt: Event) => evt.id);

            if (endedEventIds.length > 0) {
              supabase
                .from('events')
                .update({ status: 'Ended' })
                .in('id', endedEventIds)
                .then(({ error }) => {
                  if (error) console.error('Error updating ended events:', error);
                });
            }

            setEvents(updatedEvents);
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
  }, [browserTimeZone]);



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
      const fallbackLocation = [event.location_name, event.location_detail]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(', ');

      setCurrentEvent({
        ...event,
        event_timezone: event.event_timezone || browserTimeZone,
        start_date: formatDateTimeForInput(event.start_date, event.event_timezone || browserTimeZone),
        end_date: formatDateTimeForInput(event.end_date, event.event_timezone || browserTimeZone),
        location: event.location && event.location.trim().length > 0 ? event.location : fallbackLocation,
        booth_detail: event.booth_detail && event.booth_detail.trim().length > 0 ? event.booth_detail : event.booth_number
      });
      setIsEditingEvent(true);
    } else {
      setCurrentEvent({
        event_name: '',
        event_timezone: browserTimeZone,
        location: '',
        booth_detail: '',
        queueing_area: '',
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
    const { name, value } = e.target;

    if (name === 'event_timezone') {
      const previousTimeZone = currentEvent.event_timezone || browserTimeZone;
      const nextTimeZone = value || browserTimeZone;
      const nextEvent = { ...currentEvent, event_timezone: nextTimeZone };

      if (currentEvent.start_date) {
        const startDate = parseDateTimeInputInTimeZone(currentEvent.start_date, previousTimeZone);
        if (startDate) {
          nextEvent.start_date = formatDateTimeForInput(startDate, nextTimeZone);
        }
      }

      if (currentEvent.end_date) {
        const endDate = parseDateTimeInputInTimeZone(currentEvent.end_date, previousTimeZone);
        if (endDate) {
          nextEvent.end_date = formatDateTimeForInput(endDate, nextTimeZone);
        }
      }

      setCurrentEvent(nextEvent);
      return;
    }

    setCurrentEvent({ ...currentEvent, [name]: value });
  };

  const handleEventSave = async () => {
    if (!artist || !currentEvent.event_name || !currentEvent.start_date) {
      alert("Please fill in required fields (Name, Start Date)");
      return;
    }

    try {
      setIsSaving(true);
      const eventTimeZone = currentEvent.event_timezone || browserTimeZone;
      const parsedStart = parseDateTimeInputInTimeZone(currentEvent.start_date || '', eventTimeZone);

      if (!parsedStart) {
        alert('Invalid start date/time. Please check the selected timezone and date.');
        return;
      }

      let parsedEnd = currentEvent.end_date
        ? parseDateTimeInputInTimeZone(currentEvent.end_date, eventTimeZone)
        : null;

      if (!parsedEnd || parsedEnd.getTime() <= parsedStart.getTime()) {
        const startDatePart = (currentEvent.start_date || '').split('T')[0];
        const defaultEndInput = `${startDatePart}T23:59`;
        parsedEnd = parseDateTimeInputInTimeZone(defaultEndInput, eventTimeZone);
      }

      if (!parsedEnd) {
        parsedEnd = new Date(parsedStart.getTime() + 60 * 60 * 1000);
      }
      
      const eventPayload = {
        ...currentEvent,
        artist_id: artist.id,
        event_timezone: eventTimeZone,
        start_date: parsedStart.toISOString(),
        end_date: parsedEnd.toISOString(),
        location_name: currentEvent.location || '',
        location_detail: null,
        booth_number: currentEvent.booth_detail || null
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
        const normalizedData = {
          ...data,
          event_timezone: data.event_timezone || browserTimeZone,
          location:
            data.location && data.location.trim().length > 0
              ? data.location
              : [data.location_name, data.location_detail]
                  .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                  .join(', '),
          booth_detail:
            data.booth_detail && data.booth_detail.trim().length > 0
              ? data.booth_detail
              : data.booth_number,
        };

        if (isEditingEvent) {
          setEvents(events.map(e => e.id === normalizedData.id ? normalizedData : e));
        } else {
          setEvents([...events, normalizedData].sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));
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

  const handleBoothToggle = async (eventId: string, nextOpen: boolean) => {
    if (!artist) return;

    try {
      const { error } = await supabase
        .from('events')
        .update({ is_booth_open: nextOpen })
        .eq('id', eventId)
        .eq('artist_id', artist.id);

      if (error) throw error;

      setEvents((prev) => prev.map((evt) => (
        evt.id === eventId ? { ...evt, is_booth_open: nextOpen } : evt
      )));
    } catch (error) {
      console.error('Error updating booth status:', error);
      alert('Failed to update booth status.');
    }
  };

  // --- STATS LOGIC ---
  const handleOpenStats = async (event: Event) => {
      navigate(`/manage-events/${event.id}/dashboard`);
  };


  if (isLoading) return <div className="flex h-screen items-center justify-center text-pink-500 font-bold">Loading Artist Center...</div>;
  if (!artist) return <div className="flex h-screen items-center justify-center text-gray-500">Artist not found.</div>;

  const publicPageUrl = artist.slug ? `${window.location.origin}/${artist.slug}/home` : '';
  const publicMenuUrl = artist.slug ? `${window.location.origin}/${artist.slug}/menu` : '';
  const visibleEvents = events.filter(evt => {
    const eventDate = new Date(evt.start_date);
    const matchMonth = filterMonth === 'all' || eventDate.getMonth() === filterMonth;
    const matchYear = filterYear === 'all' || eventDate.getFullYear() === filterYear;
    return matchMonth && matchYear;
  });

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
           {artist.slug && (
             <div className="flex flex-col sm:flex-row gap-2">
               <button
                 type="button"
                 onClick={() => void navigator.clipboard?.writeText(publicPageUrl)}
                 className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
               >
                 <Copy size={16} aria-hidden="true" />
                 Copy public URL
               </button>
               <a
                 href={publicMenuUrl}
                 target="_blank"
                 rel="noreferrer"
                 className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:bg-gray-50"
               >
                 <ExternalLink size={16} aria-hidden="true" />
                 Open public catalog
               </a>
             </div>
           )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- LEFT COL: Profile Settings --- */}
          <div className="workspace-card h-auto self-start">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
               <User className="text-[#d63384]" size={16} />
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
               <div className="space-y-1">
                  <label htmlFor="artist-display-name" className="text-xs font-bold uppercase text-slate-500 tracking-wider">Display Name</label>
                  <input 
                    id="artist-display-name"
                    name="display_name"
                    value={artist.display_name}
                    onChange={handleProfileChange}
                    className="w-full min-h-11 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-500 transition-all"
                  />
               </div>

               {/* Bio */}
               <div className="space-y-1">
                  <label htmlFor="artist-bio" className="text-xs font-bold uppercase text-slate-500 tracking-wider">Bio</label>
                  <textarea 
                    id="artist-bio"
                    name="bio"
                    value={artist.bio}
                    onChange={handleProfileChange}
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-500 transition-all resize-none leading-relaxed"
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
                             id={`artist-${field}`}
                             name={field}
                             value={(artist as any)[field] || ''}
                             onChange={handleProfileChange}
                             placeholder={field === 'email' ? 'contact@email.com' : '...'}
                             aria-label={field.replace('_url', '').replace('email', 'Email')}
                             className="w-full min-h-10 bg-white border border-gray-200 rounded-lg pl-16 pr-2 py-2 text-sm font-medium text-slate-600 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all"
                          />
                       </div>
                     ))}
                  </div>
               </div>

               <Button 
                 onClick={handleProfileSave} 
                 disabled={isSaving}
                 className="w-full mt-1 bg-pink-600 hover:bg-pink-700 text-white font-bold h-11 text-sm rounded-xl shadow-md shadow-pink-200 active:scale-95 transition-all"
               >
                 {isSaving ? 'Saving...' : 'Save Updates'}
               </Button>
            </div>
          </div>


           {/* --- RIGHT COL: Event Management --- */}
          <div className="lg:col-span-2 space-y-6">
             
             <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px] flex flex-col">
                <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4">
                   {/* Header Row */}
                   <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="text-[#d63384]" size={20} />
                        <h2 className="font-bold text-lg text-slate-800">Event Management</h2>
                        <span className="bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full text-xs font-bold">{events.length}</span>
                      </div>
                      <Button onClick={() => handleOpenModal()} className="bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-bold px-4 h-9 shadow-sm flex items-center gap-2">
                         <Plus size={14} /> Add Event
                      </Button>
                   </div>

                   {/* Filter Row */}
                   <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Filter:</span>
                      
                      {/* Month Filter */}
                      <select
                        value={filterMonth}
                        onChange={(e) => setFilterMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none"
                        aria-label="Filter by month"
                      >
                        <option value="all">All Months</option>
                        {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                          <option key={month} value={idx}>{month}</option>
                        ))}
                      </select>

                      {/* Year Filter */}
                      <select
                        value={filterYear}
                        onChange={(e) => setFilterYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                        className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-gray-700 focus:border-pink-500 focus:ring-1 focus:ring-pink-500 outline-none"
                        aria-label="Filter by year"
                      >
                        <option value="all">All Years</option>
                        {(() => {
                          const years = [...new Set(events.map(e => new Date(e.start_date).getFullYear()))].sort((a, b) => b - a);
                          if (years.length === 0) years.push(new Date().getFullYear());
                          return years.map(year => (
                            <option key={year} value={year}>{year}</option>
                          ));
                        })()}
                      </select>

                      {/* Clear Filters */}
                      {(filterMonth !== 'all' || filterYear !== 'all') && (
                        <button
                          onClick={() => { setFilterMonth('all'); setFilterYear('all'); }}
                          className="text-xs text-pink-600 hover:text-pink-700 font-semibold underline"
                        >
                          Clear
                        </button>
                      )}

                      {/* Filtered Count */}
                      <span className="ml-auto text-xs text-gray-400 font-medium">
                        Showing {visibleEvents.length} of {events.length}
                      </span>
                   </div>
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
                            {visibleEvents
                              .map((evt) => (
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
                                     <div className="font-bold text-slate-900 text-sm">
                                       {evt.event_name}
                                     </div>
                                     <div className="flex items-center gap-3 mt-1">
                                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                          evt.status === 'Cancelled' ? 'bg-red-100 text-red-600' : 
                                          evt.status === 'Ended' ? 'bg-gray-100 text-gray-500' : 
                                          'bg-green-100 text-green-600'
                                        }`}>
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
                                           {evt.location || '-'}
                                           {evt.booth_detail && <span className="block text-gray-400 text-[10px]">Booth: {evt.booth_detail}</span>}
                                        </span>
                                     </div>
                                  </td>
                                  <td className="px-4 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 transition-opacity whitespace-nowrap">
                                        <button
                                          onClick={() => handleBoothToggle(evt.id, !evt.is_booth_open)}
                                          className={`workspace-action min-h-10 inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors border ${
                                            evt.is_booth_open
                                              ? 'text-gray-700 hover:bg-gray-50 border-gray-200'
                                              : 'text-pink-600 hover:bg-pink-50 border-pink-100'
                                          }`}
                                          title={evt.is_booth_open ? 'Close booth' : 'Open booth'}
                                        >
                                           <span className={`w-2 h-2 rounded-full ${evt.is_booth_open ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                                           {evt.is_booth_open ? 'Close Booth' : 'Open Booth'}
                                        </button>

                                        <button
                                          onClick={() => handleOpenStats(evt)}
                                          className="workspace-action min-h-10 inline-flex items-center gap-1.5 text-xs font-bold text-pink-600 hover:bg-pink-50 px-3 py-2 rounded-lg transition-colors border border-pink-100"
                                          title="Open dashboard"
                                          aria-label={`Open dashboard for ${evt.event_name}`}
                                        >
                                           <BarChart2 size={14} />
                                           Dashboard
                                        </button>

                                        <button
                                          onClick={() => navigate(`/manage-events/${evt.id}/history`)}
                                          className="workspace-action min-h-10 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-2 rounded-lg transition-colors border border-emerald-100"
                                          title="Open order history"
                                          aria-label={`Open orders for ${evt.event_name}`}
                                        >
                                           <FileText size={14} />
                                           Orders
                                        </button>

                                        <button
                                          onClick={() => navigate(`/live/queue?eventId=${evt.id}`)}
                                          className="workspace-action min-h-10 inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-2 rounded-lg transition-colors border border-indigo-100"
                                          title="Open live queue"
                                          aria-label={`Open live queue for ${evt.event_name}`}
                                        >
                                           <Users size={14} />
                                           Live Queue
                                        </button>

                                        <button
                                          onClick={() => navigate(`/live/pos?eventId=${evt.id}`)}
                                          className="workspace-action min-h-10 inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 px-3 py-2 rounded-lg transition-colors border border-slate-200"
                                          title="Open live POS"
                                          aria-label={`Open live POS for ${evt.event_name}`}
                                        >
                                           <ShoppingCart size={14} />
                                           Live POS
                                        </button>

                                        <button
                                          onClick={() => handleOpenModal(evt)}
                                          className="workspace-action min-h-10 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors border border-blue-100"
                                          title="Edit event"
                                          aria-label={`Edit ${evt.event_name}`}
                                        >
                                           Edit
                                        </button>
                                        <button
                                          onClick={() => handleEventDelete(evt.id)}
                                          className="workspace-action min-h-10 ml-2 inline-flex items-center gap-1.5 text-xs font-bold text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors border border-red-100"
                                          title="Delete event"
                                          aria-label={`Delete ${evt.event_name}`}
                                        >
                                           <Trash2 size={14} />
                                           Delete
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
                  <button onClick={() => setIsModalOpen(false)} className="icon-touch inline-flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100" aria-label="Close event form">
                     <X size={20} />
                  </button>
               </div>
               
               <div className="p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
                     <p className="text-xs font-black uppercase tracking-wide text-pink-700">Event timing</p>
                     <p className="mt-1 text-xs font-semibold text-pink-800/80">Queue days reset using this event timezone, so choose the timezone where the booth is actually running.</p>
                  </div>

                  <div className="flex items-center justify-between gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                     <div className="space-y-1 flex-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Status</label>
                        <select name="status" value={currentEvent.status || 'Confirmed'} onChange={handleFunctionChange} className="w-full bg-white border border-gray-200 rounded-md p-2 text-sm font-semibold focus:border-pink-500 outline-none" aria-label="Event status">
                           <option value="Confirmed">Confirmed</option>
                           <option value="Cancelled">Cancelled</option>
                           <option value="Ended">Ended</option>
                        </select>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Event Name *</label>
                     <input name="event_name" value={currentEvent.event_name} onChange={handleFunctionChange} className="input-field w-full border border-gray-200 rounded-lg p-3 font-semibold focus:ring-pink-500 focus:border-pink-500 outline-none" placeholder="e.g. Cosplay Festival 2026" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Time Zone *</label>
                     <select
                        name="event_timezone"
                        value={currentEvent.event_timezone || browserTimeZone}
                        onChange={handleFunctionChange}
                        className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500 bg-white"
                        aria-label="Event timezone"
                     >
                        {timeZoneOptions.map((timeZone) => (
                           <option key={timeZone.value} value={timeZone.value}>
                              {timeZone.label}
                           </option>
                        ))}
                     </select>
                     <p className="mt-1 text-xs font-semibold text-gray-500">Used for end-of-day and daily queue reset.</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">Start Date *</label>
                        <input type="datetime-local" name="start_date" value={currentEvent.start_date || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-400">End Date *</label>
                        <input type="datetime-local" name="end_date" value={currentEvent.end_date || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Location</label>
                     <input name="location" value={currentEvent.location || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. 5th Floor, Siam Paragon" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Booth Detail</label>
                     <input name="booth_detail" value={currentEvent.booth_detail || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. Booth A12, Zone Creator Hall" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-400">Queueing Area</label>
                     <input name="queueing_area" value={currentEvent.queueing_area || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500" placeholder="e.g. Queue lane beside Booth A12" />
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


    </div>
  );
};

export default ManageArtist;
