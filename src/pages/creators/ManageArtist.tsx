import { useState, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { supabase } from '../../supabaseClient';
import {
  Trash2, Plus, Calendar, MapPin, FileText,
  BarChart2, X, User, Ticket, ExternalLink, Copy, Users, ShoppingCart, PackageCheck, MoreHorizontal, Settings
} from 'lucide-react';
import { Button } from '../../components/ui';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AvatarUpload from '../../components/AvatarUpload';
import AdminHeader from '../../components/AdminHeader';
import { getAuthUserSafe } from '../../utils/auth';
import { fetchActorContext } from '../../utils/access';
import type { ActorContext } from '../../types/access';
import type { EventSellingMode, OrderType, PickupStatus } from '../../types/preorder';
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
  is_public?: boolean;
  is_verified?: boolean;
  published_at?: string | null;

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
  selling_mode?: EventSellingMode | null;
  preorder_opens_at?: string | null;
  preorder_closes_at?: string | null;
  preorder_pickup_instructions?: string | null;
}

interface EventMetric {
  awaitingPickup: number;
  completedOrders: number;
  queueWaiting: number;
  revenue: number;
  currency: string;
}

interface EventMetricOrder {
  event_id?: string | null;
  status?: string | null;
  total_price?: number | null;
  currency?: string | null;
  order_type?: OrderType | null;
  pickup_status?: PickupStatus | null;
}

interface EventMetricQueue {
  event_id?: string | null;
  status?: string | null;
}

const getEventDateParts = (dateString: string, timeZone?: string | null) => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: timeZone || getBrowserTimeZone(),
  }).formatToParts(date);

  return {
    day: parts.find((part) => part.type === 'day')?.value || '',
    month: parts.find((part) => part.type === 'month')?.value || '',
    year: parts.find((part) => part.type === 'year')?.value || '',
  };
};

const formatEventDateRange = (event: Event) => {
  const start = getEventDateParts(event.start_date, event.event_timezone);
  const end = getEventDateParts(event.end_date, event.event_timezone);
  if (!start || !end) {
    return { primary: '-', secondary: '' };
  }

  if (start.day === end.day && start.month === end.month && start.year === end.year) {
    return { primary: `${start.day} ${start.month}`, secondary: start.year };
  }

  if (start.month === end.month && start.year === end.year) {
    return { primary: `${start.day}-${end.day} ${start.month}`, secondary: start.year };
  }

  if (start.year === end.year) {
    return { primary: `${start.day} ${start.month}-${end.day} ${end.month}`, secondary: start.year };
  }

  return {
    primary: `${start.day} ${start.month} ${start.year}-${end.day} ${end.month} ${end.year}`,
    secondary: '',
  };
};

const getPublishErrorMessage = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error || '');
  const messages: Array<[string, string]> = [
    ['artist_slug_required', 'Add a public booth URL before publishing.'],
    ['artist_display_name_required', 'Add the booth display name before publishing.'],
    ['artist_contact_required', 'Add a creator contact email before publishing.'],
    ['event_timezone_required', 'Set the event timezone before publishing.'],
    ['event_location_required', 'Set the event location before publishing.'],
    ['event_booth_or_queue_area_required', 'Add a booth number/detail or queue meeting area before publishing.'],
    ['customer_visible_product_required', 'Add at least one enabled product to the customer catalog before publishing.'],
    ['fulfillment_instructions_required', 'Add pickup or fulfillment instructions before publishing timed orders.'],
    ['payment_instructions_required', 'Add an enabled payment method or payment instructions before publishing timed orders.'],
    ['event_not_customer_visible', 'Choose a confirmed event that has not ended.'],
  ];
  return messages.find(([code]) => raw.includes(code))?.[1] || raw || 'Failed to publish public booth.';
};

const emptyMetric: EventMetric = {
  awaitingPickup: 0,
  completedOrders: 0,
  queueWaiting: 0,
  revenue: 0,
  currency: 'THB',
};

const isEndedEvent = (event: Event) => {
  const endDate = new Date(event.end_date);
  return (
    event.status === 'Ended' ||
    event.status === 'Cancelled' ||
    event.selling_mode === 'closed' ||
    (!Number.isNaN(endDate.getTime()) && endDate < new Date())
  );
};

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'THB' ? 0 : 2,
  }).format(amount || 0);

const ManageArtist = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const browserTimeZone = getBrowserTimeZone();
  const profilePanelRef = useRef<HTMLDivElement>(null);
  
  const [artist, setArtist] = useState<Artist | null>(null);
  const [actorContext, setActorContext] = useState<ActorContext | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventMetrics, setEventMetrics] = useState<Record<string, EventMetric>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishingPublicLink, setIsPublishingPublicLink] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [publishError, setPublishError] = useState<string | null>(null);
  
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
  const [eventTab, setEventTab] = useState<'active' | 'ended'>(() => (
    searchParams.get('tab') === 'ended' ? 'ended' : 'active'
  ));

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

        const ctx = await fetchActorContext();
        if (!ctx?.artist_id) {
          navigate('/manage-login');
          return;
        }
        if (isMounted) setActorContext(ctx);

        // 2. Fetch Artist by workspace ID. Manager/staff accounts do not own
        // an artists row, so auth user id is not the artist id for them.
        const { data: artistData, error: artistError } = await supabase
          .from('artists')
          .select('id, slug, display_name, bio, image_url, is_public, is_verified, published_at, x_url, ig_url, facebook_url, tiktok_url, email')
          .eq('id', ctx.artist_id)
          .maybeSingle();

        if (artistError) throw artistError;
        if (!artistData) throw new Error('Artist workspace not found.');

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

            const eventIds = updatedEvents.map((evt) => evt.id);
            if (eventIds.length > 0) {
              const [ordersResult, queuesResult] = await Promise.all([
                supabase
                  .from('orders')
                  .select('event_id, status, total_price, currency, order_type, pickup_status')
                  .in('event_id', eventIds),
                supabase
                  .from('queues')
                  .select('event_id, status')
                  .in('event_id', eventIds),
              ]);

              const nextMetrics: Record<string, EventMetric> = {};
              eventIds.forEach((eventId) => {
                nextMetrics[eventId] = { ...emptyMetric };
              });

              if (!ordersResult.error) {
                ((ordersResult.data || []) as EventMetricOrder[]).forEach((order) => {
                  if (!order.event_id || !nextMetrics[order.event_id]) return;
                  const metric = nextMetrics[order.event_id];
                  if (order.order_type === 'preorder' && order.pickup_status === 'awaiting_pickup') {
                    metric.awaitingPickup += 1;
                  }
                  if (order.status === 'completed') {
                    metric.completedOrders += 1;
                    metric.revenue += Number(order.total_price || 0);
                    metric.currency = order.currency || metric.currency;
                  } else if (order.currency) {
                    metric.currency = order.currency;
                  }
                });
              }

              if (!queuesResult.error) {
                ((queuesResult.data || []) as EventMetricQueue[]).forEach((queue) => {
                  if (!queue.event_id || !nextMetrics[queue.event_id]) return;
                  if (['waiting', 'calling', 'serving', 'queued'].includes(queue.status || '')) {
                    nextMetrics[queue.event_id].queueWaiting += 1;
                  }
                });
              }

              if (isMounted) setEventMetrics(nextMetrics);
            } else if (isMounted) {
              setEventMetrics({});
            }
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

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (requestedTab === 'ended' || requestedTab === 'active') {
      setEventTab(requestedTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (searchParams.get('tab') === 'profile') {
      window.setTimeout(() => {
        profilePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [searchParams]);

  useEffect(() => {
    if (isLoading || events.length === 0) return;

    const forcedGrid =
      searchParams.get('view') === 'all' ||
      searchParams.get('tab') === 'profile' ||
      searchParams.has('editEvent') ||
      (typeof window !== 'undefined' && window.sessionStorage.getItem('forceEventGrid') === 'true');

    const activeEvents = events.filter((event) => !isEndedEvent(event));
    if (!forcedGrid && activeEvents.length === 1) {
      navigate(`/manage-events/${activeEvents[0].id}/workspace`, { replace: true });
    }
  }, [events, isLoading, navigate, searchParams]);

  useEffect(() => {
    const editEventId = searchParams.get('editEvent');
    if (isLoading || !editEventId || isModalOpen) return;

    const eventToEdit = events.find((event) => event.id === editEventId);
    if (!eventToEdit) return;

    handleOpenModal(eventToEdit);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('editEvent');
    nextParams.set('view', 'all');
    setSearchParams(nextParams, { replace: true });
  }, [events, isLoading, isModalOpen, searchParams, setSearchParams]);

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

  const getShareableEvent = () => {
    const now = new Date();
    const customerVisibleEvents = events
      .filter((event) => event.status === 'Confirmed' && new Date(event.end_date) >= now)
      .sort((left, right) => {
        const openScore = Number(Boolean(right.is_booth_open)) - Number(Boolean(left.is_booth_open));
        if (openScore !== 0) return openScore;
        return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
      });

    return customerVisibleEvents[0] || null;
  };

  const publishPublicBooth = async () => {
    if (!artist?.id || !artist.slug) {
      throw new Error('Set a public slug before sharing this booth.');
    }

    const shareableEvent = getShareableEvent();
    if (!shareableEvent) {
      throw new Error('Add a confirmed, non-expired event before sharing this booth.');
    }

    const { data, error } = await supabase.rpc('publish_artist_public_booth', {
      p_artist_id: artist.id,
      p_event_id: shareableEvent.id,
    });

    if (error) throw error;

    const publishedArtist = Array.isArray(data) ? data[0] : null;
    if (publishedArtist) {
      setArtist((prev) => prev ? {
        ...prev,
        is_public: publishedArtist.is_public,
        is_verified: publishedArtist.is_verified,
        published_at: publishedArtist.published_at,
      } : prev);
    }

    return shareableEvent;
  };

  const handlePublishPublicBooth = async () => {
    if (isPublishingPublicLink) return;

    try {
      setIsPublishingPublicLink(true);
      setPublishError(null);
      await publishPublicBooth();
      setCopyFeedback('idle');
    } catch (error) {
      console.error('[ManageArtist] Failed to publish public booth:', error);
      setPublishError(getPublishErrorMessage(error));
    } finally {
      setIsPublishingPublicLink(false);
    }
  };

  const handleCopyPublicUrl = async () => {
    if (!publicPageUrl || isPublishingPublicLink) return;

    try {
      setIsPublishingPublicLink(true);
      if (!artist?.is_public) throw new Error('Publish the booth before copying its public URL.');
      await navigator.clipboard.writeText(publicPageUrl);
      setCopyFeedback('copied');
    } catch (error) {
      console.error('[ManageArtist] Failed to copy public URL:', error);
      setCopyFeedback('failed');
      alert(error instanceof Error ? error.message : 'Failed to copy public URL.');
    } finally {
      setIsPublishingPublicLink(false);
    }

    window.setTimeout(() => setCopyFeedback('idle'), 2500);
  };

  const handleOpenPublicCatalog = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();

    if (isPublishingPublicLink) {
      return;
    }

    try {
      setIsPublishingPublicLink(true);
      if (!artist?.is_public) throw new Error('Publish the booth before opening its public catalog.');
      window.open(publicMenuUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('[ManageArtist] Failed to open public catalog:', error);
      setCopyFeedback('failed');
      alert(error instanceof Error ? error.message : 'Failed to publish public catalog.');
      window.setTimeout(() => setCopyFeedback('idle'), 2500);
    } finally {
      setIsPublishingPublicLink(false);
    }
  };


  if (isLoading) return <div className="flex h-screen items-center justify-center text-pink-500 font-bold">Loading Artist Center...</div>;
  if (!artist) return <div className="flex h-screen items-center justify-center text-gray-500">Artist not found.</div>;

  const publicPageUrl = artist.slug ? `${window.location.origin}/${artist.slug}/home` : '';
  const publicMenuUrl = artist.slug ? `${window.location.origin}/${artist.slug}/menu` : '';
  const activeEvents = events.filter((event) => !isEndedEvent(event));
  const endedEvents = events.filter(isEndedEvent);
  const currentTabEvents = eventTab === 'active' ? activeEvents : endedEvents;
  const visibleEvents = currentTabEvents.filter(evt => {
    const eventDate = new Date(evt.start_date);
    const matchMonth = filterMonth === 'all' || eventDate.getMonth() === filterMonth;
    const matchYear = filterYear === 'all' || eventDate.getFullYear() === filterYear;
    return matchMonth && matchYear;
  });
  const showFullGrid = searchParams.get('view') === 'all' || activeEvents.length !== 1;

  const setTab = (nextTab: 'active' | 'ended') => {
    setEventTab(nextTab);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('view', 'all');
    nextParams.set('tab', nextTab);
    setSearchParams(nextParams);
  };

  const openWorkspace = (eventId: string) => {
    window.sessionStorage.removeItem('forceEventGrid');
    navigate(`/manage-events/${eventId}/workspace`);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-slate-800">
       
       {/* ✅ Unified Admin Header */}
       <AdminHeader activePage="events" actorRole={actorContext?.role} userEmail={actorContext?.member_email} />

      {/* Main Content */}
      <main className="w-full max-w-[1140px] mx-auto px-4 md:px-6 pb-12 pt-2 overflow-x-hidden">
        
        {/* Header */}
        <div className="mb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
           <div>
              <h1 className="text-xl font-black text-gray-800 tracking-tight">Manage profile and events</h1>
              <p className="text-sm md:text-base text-pink-700 font-bold">{artist.display_name}</p>
           </div>
           {artist.slug && (
             <div className="flex flex-col sm:flex-row gap-2">
               {!artist.is_public && (
                 <button
                   type="button"
                   onClick={handlePublishPublicBooth}
                   disabled={isPublishingPublicLink || !getShareableEvent()}
                   className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl bg-pink-700 px-4 py-2 text-sm font-black text-white hover:bg-pink-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                   title={getShareableEvent() ? `Publish /${artist.slug} for ${getShareableEvent()?.event_name}` : 'Add a confirmed, non-expired event first'}
                 >
                   <ExternalLink size={16} aria-hidden="true" />
                   {isPublishingPublicLink ? 'Publishing…' : 'Publish booth'}
                 </button>
               )}
               <button
                 type="button"
                 onClick={handleCopyPublicUrl}
                 disabled={isPublishingPublicLink || !artist.is_public}
                 title={artist.is_public ? publicPageUrl : 'Publish the booth before sharing'}
                 className="workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-3 py-2 text-sm font-black text-pink-700 hover:bg-pink-100"
               >
                 <Copy size={16} aria-hidden="true" />
                 {copyFeedback === 'copied' ? 'Link copied' : copyFeedback === 'failed' ? 'Copy failed' : 'Copy public URL'}
               </button>
               <a
                 href={publicMenuUrl}
                 target="_blank"
                 rel="noreferrer"
                 onClick={handleOpenPublicCatalog}
                 aria-disabled={!artist.is_public}
                 title={artist.is_public ? publicMenuUrl : 'Publish the booth before opening the customer catalog'}
                 className={`workspace-action inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-black ${artist.is_public ? 'text-gray-700 hover:bg-gray-50' : 'cursor-not-allowed text-gray-400'}`}
               >
                 <ExternalLink size={16} aria-hidden="true" />
                 Open public catalog
               </a>
             </div>
           )}
        </div>

        {publishError && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900" role="alert">
            <span>{publishError}</span>
            <button type="button" onClick={() => setPublishError(null)} className="min-h-11 shrink-0 rounded-lg px-3 text-xs font-black text-amber-900 hover:bg-amber-100">Dismiss</button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* --- LEFT COL: Profile Settings --- */}
          <div ref={profilePanelRef} className="workspace-card h-auto self-start scroll-mt-20">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center gap-2">
               <User className="text-pink-700" size={16} />
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
                    value={artist.display_name || ''}
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
                    value={artist.bio || ''}
                    onChange={handleProfileChange}
                    rows={3}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-500 transition-all resize-none leading-relaxed"
                  />
               </div>

               <div className="h-px bg-gray-100 my-0.5"></div>

               {/* Socials */}
               <div className="space-y-1">
                  <h3 className="text-[10px] font-bold uppercase text-slate-600 tracking-wider mb-0.5">Social Links</h3>
                  <div className="flex flex-col gap-1">
                     {['x_url', 'ig_url', 'facebook_url', 'tiktok_url', 'email'].map((field) => (
                       <div key={field} className="relative group">
                          <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
                             <span className="text-[9px] font-bold text-gray-600 uppercase w-16 truncate">
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
                             className="w-full min-h-11 bg-white border border-gray-200 rounded-lg pl-16 pr-2 py-2 text-sm font-medium text-slate-600 focus:outline-none focus:border-pink-500 focus:ring-2 focus:ring-pink-200 transition-all"
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


           {/* --- RIGHT COL: Event Workspaces --- */}
          <div className="lg:col-span-2 space-y-5">
            <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="text-pink-700" size={20} aria-hidden="true" />
                  <div>
                    <h2 className="font-black text-lg text-slate-900">Event Workspaces</h2>
                    <p className="text-xs font-semibold text-gray-600">
                      {showFullGrid ? 'Choose an event, then manage its operations inside the workspace.' : 'Opening your active event workspace...'}
                    </p>
                  </div>
                </div>
                <Button onClick={() => handleOpenModal()} className="bg-slate-900 text-white hover:bg-slate-800 rounded-lg text-xs font-bold px-4 h-11 shadow-sm flex items-center gap-2">
                  <Plus size={14} aria-hidden="true" /> Add Event
                </Button>
              </div>

              <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setTab('active')}
                    className={`min-h-11 rounded-lg px-3 text-xs font-black transition ${eventTab === 'active' ? 'bg-white text-pink-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    กำลังดำเนินการ {activeEvents.length}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('ended')}
                    className={`min-h-11 rounded-lg px-3 text-xs font-black transition ${eventTab === 'ended' ? 'bg-white text-pink-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'}`}
                  >
                    จบแล้ว {endedEvents.length}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500"
                    aria-label="Filter by month"
                  >
                    <option value="all">All Months</option>
                    {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month, idx) => (
                      <option key={month} value={idx}>{month}</option>
                    ))}
                  </select>
                  <select
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                    className="min-h-11 rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500"
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
                  {(filterMonth !== 'all' || filterYear !== 'all') && (
                    <button
                      onClick={() => { setFilterMonth('all'); setFilterYear('all'); }}
                      className="min-h-11 rounded-lg px-2 text-xs font-black text-pink-700 hover:bg-pink-50"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            </section>

            {events.length === 0 ? (
              <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
                <Calendar size={42} className="mx-auto mb-3 text-gray-300" aria-hidden="true" />
                <h3 className="text-base font-black text-gray-800">No events scheduled.</h3>
                <p className="mt-1 text-sm font-semibold text-gray-600">Create your first event to start building a workspace.</p>
              </section>
            ) : visibleEvents.length === 0 ? (
              <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center">
                <p className="text-sm font-bold text-gray-600">No events match this tab and filter.</p>
              </section>
            ) : (
              <section className="grid gap-4 md:grid-cols-2" aria-label="Event workspace list">
                {visibleEvents.map((evt) => {
                  const metric = eventMetrics[evt.id] || emptyMetric;
                  const eventDateRange = formatEventDateRange(evt);
                  const ended = isEndedEvent(evt);
                  const statusBadgeClass = ended
                    ? 'bg-gray-100 text-gray-600'
                    : evt.selling_mode === 'preorder'
                      ? 'bg-pink-100 text-pink-700'
                      : 'bg-emerald-100 text-emerald-700';
                  const boothBadgeClass = evt.is_booth_open
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-600';

                  return (
                    <article key={evt.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${statusBadgeClass}`}>
                              {ended ? 'Ended' : evt.selling_mode || evt.status}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${boothBadgeClass}`}>
                              {evt.is_booth_open ? 'Booth open' : 'Booth closed'}
                            </span>
                          </div>
                          <h3 className="mt-2 truncate text-lg font-black text-slate-900">{evt.event_name}</h3>
                          <p className="mt-1 text-sm font-semibold text-gray-600">
                            {eventDateRange.primary}{eventDateRange.secondary ? ` ${eventDateRange.secondary}` : ''}
                          </p>
                        </div>

                        <details className="relative shrink-0">
                          <summary className="workspace-action flex h-11 w-11 cursor-pointer list-none items-center justify-center border border-gray-200 bg-white text-gray-600 hover:bg-gray-50" aria-label={`More actions for ${evt.event_name}`}>
                            <MoreHorizontal size={18} aria-hidden="true" />
                          </summary>
                          <div className="absolute right-0 top-12 z-10 w-44 rounded-xl border border-gray-200 bg-white p-1.5 text-sm font-bold shadow-lg">
                            {!ended && (
                              <button onClick={() => handleBoothToggle(evt.id, !evt.is_booth_open)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50">
                                <span className={`h-2 w-2 rounded-full ${evt.is_booth_open ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                                {evt.is_booth_open ? 'Close booth' : 'Open booth'}
                              </button>
                            )}
                            <button onClick={() => handleOpenModal(evt)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><Settings size={14} />Edit</button>
                            <button onClick={() => handleOpenStats(evt)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><BarChart2 size={14} />Dashboard</button>
                            <button onClick={() => navigate(`/manage-events/${evt.id}/history`)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><FileText size={14} />Orders</button>
                            <button onClick={() => navigate(`/manage-events/${evt.id}/preorder`)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><Ticket size={14} />Pre-order</button>
                            <button onClick={() => navigate(`/manage-events/${evt.id}/pickup`)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><PackageCheck size={14} />Pickup</button>
                            {!ended && <button onClick={() => navigate(`/live/queue?eventId=${evt.id}`)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><Users size={14} />Live Queue</button>}
                            {!ended && <button onClick={() => navigate(`/live/pos?eventId=${evt.id}`)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"><ShoppingCart size={14} />Live POS</button>}
                            <div className="my-1 h-px bg-gray-100" />
                            <button onClick={() => handleEventDelete(evt.id)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-600 hover:bg-red-50"><Trash2 size={14} />Delete</button>
                          </div>
                        </details>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="rounded-xl bg-gray-50 p-2">
                          <p className="text-[10px] font-black uppercase text-gray-600">Pickup</p>
                          <p className="mt-1 text-sm font-black text-gray-900">{metric.awaitingPickup}</p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-2">
                          <p className="text-[10px] font-black uppercase text-gray-600">Queue</p>
                          <p className="mt-1 text-sm font-black text-gray-900">{metric.queueWaiting}</p>
                        </div>
                        <div className="rounded-xl bg-gray-50 p-2">
                          <p className="text-[10px] font-black uppercase text-gray-600">Sales</p>
                          <p className="mt-1 truncate text-sm font-black text-gray-900">{formatMoney(metric.revenue, metric.currency)}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                        <button
                          onClick={() => openWorkspace(evt.id)}
                          className="workspace-action inline-flex flex-1 items-center justify-center gap-2 bg-pink-600 px-4 text-sm font-black text-white hover:bg-pink-700"
                        >
                          Manage
                        </button>
                        {!ended && (
                          <button
                            onClick={() => navigate(`/live/queue?eventId=${evt.id}`)}
                            className="workspace-action inline-flex items-center justify-center gap-2 border border-indigo-100 bg-indigo-50 px-4 text-sm font-black text-indigo-700 hover:bg-indigo-100"
                          >
                            <Users size={16} aria-hidden="true" />
                            Live Ops
                          </button>
                        )}
                      </div>

                      {(evt.location || evt.booth_detail) && (
                        <div className="mt-3 flex items-start gap-1.5 text-xs font-semibold text-gray-600">
                          <MapPin size={13} className="mt-0.5 shrink-0 text-pink-400" aria-hidden="true" />
                          <span>{evt.location || '-'}{evt.booth_detail ? ` · Booth ${evt.booth_detail}` : ''}</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>
            )}
          </div>
        </div>
        
      </main>
      
      {/* --- ADD/EDIT MODAL --- */}
      {isModalOpen && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="event-form-title"
              className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
            >
               <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                  <h3 id="event-form-title" className="font-bold text-lg text-slate-800">{isEditingEvent ? 'Edit Event' : 'New Event'}</h3>
                  <button onClick={() => setIsModalOpen(false)} className="icon-touch inline-flex items-center justify-center text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-100" aria-label="Close event form">
                     <X size={20} aria-hidden="true" />
                  </button>
               </div>
               
               <div className="p-6 overflow-y-auto space-y-4 text-sm">
                  <div className="rounded-xl border border-pink-100 bg-pink-50 p-3">
                     <p className="text-xs font-black uppercase tracking-wide text-pink-700">Event timing</p>
                     <p className="mt-1 text-xs font-semibold text-pink-800/80">Queue days reset using this event timezone, so choose the timezone where the booth is actually running.</p>
                  </div>

                  <div className="flex items-center justify-between gap-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                     <div className="space-y-1 flex-1">
                        <label className="font-bold text-xs uppercase text-gray-600">Status</label>
                        <select name="status" value={currentEvent.status || 'Confirmed'} onChange={handleFunctionChange} className="min-h-11 w-full bg-white border border-gray-200 rounded-md px-3 py-2 text-sm font-semibold focus:border-pink-500 outline-none" aria-label="Event status">
                           <option value="Confirmed">Confirmed</option>
                           <option value="Cancelled">Cancelled</option>
                           <option value="Ended">Ended</option>
                        </select>
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Event Name *</label>
                     <input name="event_name" value={currentEvent.event_name} onChange={handleFunctionChange} className="input-field w-full border border-gray-200 rounded-lg p-3 font-semibold focus:ring-pink-500 focus:border-pink-500 outline-none" placeholder="e.g. Cosplay Festival 2026" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Time Zone *</label>
                     <select
                        name="event_timezone"
                        value={currentEvent.event_timezone || browserTimeZone}
                        onChange={handleFunctionChange}
                        className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500 bg-white"
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
                        <label className="font-bold text-xs uppercase text-gray-600">Start Date *</label>
                        <input type="datetime-local" name="start_date" value={currentEvent.start_date || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" />
                     </div>
                     <div className="space-y-1">
                        <label className="font-bold text-xs uppercase text-gray-600">End Date *</label>
                        <input type="datetime-local" name="end_date" value={currentEvent.end_date || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" />
                     </div>
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Location</label>
                     <input name="location" value={currentEvent.location || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" placeholder="e.g. 5th Floor, Siam Paragon" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Booth Detail</label>
                     <input name="booth_detail" value={currentEvent.booth_detail || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" placeholder="e.g. Booth A12, Zone Creator Hall" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Queueing Area</label>
                     <input name="queueing_area" value={currentEvent.queueing_area || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" placeholder="e.g. Queue lane beside Booth A12" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Entrance Fee</label>
                     <input name="entrance_fee" value={currentEvent.entrance_fee || ''} onChange={handleFunctionChange} className="min-h-11 w-full border border-gray-200 rounded-lg px-3 py-2.5 outline-none focus:border-pink-500" placeholder="e.g. 300 THB / Free" />
                  </div>

                  <div className="space-y-1">
                     <label className="font-bold text-xs uppercase text-gray-600">Transit Info</label>
                     <textarea name="transit_info" rows={3} value={currentEvent.transit_info || ''} onChange={handleFunctionChange} className="w-full border border-gray-200 rounded-lg p-2.5 outline-none focus:border-pink-500 resize-none" placeholder="BTS Bangna..." />
                  </div>
               </div>

               <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                  <Button variant="ghost" onClick={() => setIsModalOpen(false)} className="text-gray-700">Cancel</Button>
                  <Button onClick={handleEventSave} className="bg-pink-600 hover:bg-pink-700 text-white font-bold px-6 shadow-md shadow-pink-200">
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
